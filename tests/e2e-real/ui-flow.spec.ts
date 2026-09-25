import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createStack, rows, rpc, rpcRows, uuid, type Actor, type Stack } from './support/stack';
import {
  chooseOption,
  confirmThroughLink,
  contextWithSession,
  exact,
  msg,
  registerThroughForm,
  richLabel,
  SESSION_COOKIE,
  sessionCookieHeader,
  signInThroughForm,
} from './support/ui';

/**
 * Przepływ kandydat ↔ pracodawca KLIKANY W PRZEGLĄDARCE (#351, #66) na PostgreSQL 16
 * z migracjami produkcyjnymi: formularze rejestracji/logowania Better Auth (#24), panele
 * i Server Actions na warstwie danych PostgreSQL pod RLS (#25). Po każdym kroku UI — asercja
 * w bazie (operator czyta, nigdy nie pisze za użytkownika, z dwoma jawnymi wyjątkami niżej).
 *
 * Wyjątki (brak ścieżki UI w produkcie, nie skrót testu):
 * - weryfikację firmy wykonuje administrator RPC `admin_set_company_status` pod własną sesją,
 * - wiersz `matches` wstawia operator (pipeline materializacji dopasowań = P1-03, otwarte),
 *   bo tylko dopasowany kandydat ma w panelu przycisk „Wyślij propozycję”;
 * - ofertę publikuje pracodawca przez te same RPC co kreator, pod sesją z przeglądarki
 *   (9 kroków kreatora ma własne E2E; tu liczy się przepływ zgłoszenia).
 *
 * Kontrole ujemne: E2E_REAL_MUTATION (scripts/test-e2e-real.mjs) — każda daje czerwony test.
 */

const run = Math.random().toString(36).slice(2, 8);
const JOB_TITLE = `Heftruckchauffeur UI ${run}`;
const JOB_SLUG = `heftruckchauffeur-ui-${run}`;
const COMPANY = `Haven Logistiek ${run}`;
const EMPLOYER_EMAIL = `ui-employer-nl-${run}@e2e.invalid`;
const CANDIDATE_EMAIL = `ui-candidate-fr-${run}@e2e.invalid`;
const MESSAGE_TO_CANDIDATE = `Goedendag Claire, kunt u maandag starten? ${run}`;
const MESSAGE_TO_EMPLOYER = `Bonjour, oui, lundi me convient. ${run}`;

let stack: Stack;
let admin: Actor;
let strangerEmployer: Actor; // inna, zweryfikowana firma — kontrola ujemna w przeglądarce
let employerContext: BrowserContext;
let candidateContext: BrowserContext;
let employerPage: Page;
let candidatePage: Page;
let employer: Actor; // sesja z przeglądarki pracodawcy
let candidate: Actor; // sesja z przeglądarki kandydata
let companyId: string;
let jobId: string;
let applicationId: string;
let offerId: string;

test.describe.configure({ mode: 'serial' });

const db = async <T>(sql: string, params: unknown[] = []) => rows<T>(await stack.admin.query(sql, params));

test.beforeAll(async ({ browser }) => {
  stack = await createStack();
  employerContext = await browser.newContext();
  candidateContext = await browser.newContext();
  employerPage = await employerContext.newPage();
  candidatePage = await candidateContext.newPage();
});

test.afterAll(async () => {
  await Promise.allSettled([employerContext?.close(), candidateContext?.close()]);
  await stack?.close();
});

test('rejestracja przez formularze, potwierdzenie linkiem z kolejki, panel wg roli; bez sesji — logowanie', async ({ browser }) => {
  // Bez sesji panel odsyła do logowania (guard na tożsamości z cookie).
  await candidatePage.goto('/fr/candidate');
  await expect(candidatePage).toHaveURL(/\/fr\/logowanie/);

  await registerThroughForm(employerPage, { locale: 'nl', email: EMPLOYER_EMAIL, name: ['Jan', 'Peeters'], company: COMPANY });
  await registerThroughForm(candidatePage, { locale: 'fr', email: CANDIDATE_EMAIL, name: ['Claire', 'Dubois'] });
  // Rejestracja nie loguje (requireEmailVerification) — cookie sesji dopiero po potwierdzeniu.
  expect((await candidateContext.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE);

  await confirmThroughLink(employerPage, stack.admin, EMPLOYER_EMAIL, 'nl');
  await employerPage.waitForURL('**/nl/employer');
  await confirmThroughLink(candidatePage, stack.admin, CANDIDATE_EMAIL, 'fr');
  await candidatePage.waitForURL(/\/fr\/candidate/);

  employer = stack.actorFromCookie(EMPLOYER_EMAIL, await sessionCookieHeader(employerContext));
  candidate = stack.actorFromCookie(CANDIDATE_EMAIL, await sessionCookieHeader(candidateContext));
  expect((await employer.identity())?.role).toBe('employer');
  expect((await candidate.identity())?.role).toBe('candidate');

  // Baza: role, język odbiorcy z formularza (Invariant #1), firma z rejestracji z właścicielem.
  expect(await db(
    `SELECT u.email, p.role::text, p.preferred_locale FROM auth.users u JOIN public.profiles p ON p.id = u.id
      WHERE u.email = ANY($1) ORDER BY p.role`, [[EMPLOYER_EMAIL, CANDIDATE_EMAIL]]))
    .toEqual([
      { email: CANDIDATE_EMAIL, role: 'candidate', preferred_locale: 'fr' },
      { email: EMPLOYER_EMAIL, role: 'employer', preferred_locale: 'nl' },
    ]);
  const companies = await db<{ id: string; role: string; status: string }>(
    `SELECT c.id, m.role::text, c.status::text FROM public.companies c
       JOIN public.company_members m ON m.company_id = c.id
       JOIN auth.users u ON u.id = m.profile_id
      WHERE u.email = $1 AND m.is_active`, [EMPLOYER_EMAIL]);
  expect(companies).toEqual([expect.objectContaining({ role: 'owner', status: 'unverified' })]);
  companyId = companies[0]!.id;

  // Wylogowanie i logowanie formularzem: błędne hasło = komunikat, bez sesji; poprawne = panel.
  const fresh = await browser.newContext();
  try {
    const page = await fresh.newPage();
    await signInThroughForm(page, 'fr', CANDIDATE_EMAIL, 'WrongPassword999');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/fr\/logowanie/);
    expect((await fresh.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE);
    await signInThroughForm(page, 'fr', CANDIDATE_EMAIL);
    await page.waitForURL(/\/fr\/candidate/);
    expect((await fresh.cookies()).map((c) => c.name)).toContain(SESSION_COOKIE);
  } finally {
    await fresh.close();
  }

  // Administrator i obca firma (API Better Auth — ten sam serwer i sekret co aplikacja).
  admin = await stack.signUpCandidate(`ui-admin-${run}@e2e.invalid`, 'en', ['Ada', 'Admin']);
  await stack.admin.query(
    "UPDATE public.profiles SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = $1)", [admin.email]);
  strangerEmployer = await stack.signUpEmployer(`ui-stranger-${run}@e2e.invalid`, 'en', ['Tom', 'Smith'], 'Other UI Ltd');
  const [other] = await strangerEmployer.request((tx) => rpcRows<{ company_id: string }>(
    tx, 'create_first_company', { p_name: 'Other UI Ltd', p_slug: `other-ui-${run}` }));
  await admin.request((tx) => rpc(tx, 'admin_set_company_status', { p_company_id: other!.company_id, p_status: 'verified' }));
});

test('pracodawca: firma zweryfikowana przez admina, oferta opublikowana pod sesją z przeglądarki', async () => {
  await admin.request((tx) => rpc(tx, 'admin_set_company_status', { p_company_id: companyId, p_status: 'verified' }));
  jobId = await employer.request(async (tx) => {
    const [draft] = rows<{ id: string }>(await tx.query(
      `INSERT INTO public.jobs (company_id, created_by, slug, default_locale, title, status, category,
         contract_type, city, region)
       VALUES ($1, auth.uid(), $2, 'nl', $3, 'draft', 'logistics', 'permanent', 'Antwerpen', 'Vlaanderen')
       RETURNING id`, [companyId, `draft-${uuid()}`, JOB_TITLE]));
    await tx.query(
      `INSERT INTO public.job_translations (job_id, locale, title, description, responsibilities)
       VALUES ($1, 'nl', $2, 'Heftruck rijden in de haven van Antwerpen.', ARRAY['Laden en lossen'])`,
      [draft!.id, JOB_TITLE]);
    await rpc(tx, 'set_job_requirements', { p_job_id: draft!.id, p_locale: 'nl', p_kind: 'mandatory', p_lines: ['Heftruckattest'] });
    await rpc(tx, 'publish_job', { p_job_id: draft!.id, p_slug: JOB_SLUG });
    return draft!.id;
  });

  // Panel pracodawcy w przeglądarce czyta ofertę z bazy pod sesją.
  await employerPage.goto('/nl/employer/oferty');
  await expect(employerPage.getByText(JOB_TITLE).first()).toBeVisible();
});

test('onboarding kandydata w kreatorze: 6 kroków, walidacja pola, „Terminer” → profil ukończony w bazie', async () => {
  const t = (key: string, params?: Record<string, string | number>) => msg('fr', `onboarding.${key}`, params);
  const page = candidatePage;
  await page.goto('/fr/candidate/onboarding');
  const next = (title: string) => page.getByRole('button', { name: `${t('next')}: ${title}` });
  const saved = page.getByRole('status').filter({ hasText: exact(t('saved')) });

  // Krok 1: imię z rejestracji; telefon.
  await expect(page.getByLabel(t('firstName'), { exact: true })).toHaveValue('Claire');
  await page.getByLabel(t('phone'), { exact: true }).fill('+32470123456');
  await next(t('step2Title')).click();

  // Krok 2: bez zawodu → błąd przy polu, krok się nie zmienia (walidacja przed zapisem).
  await expect(page.getByRole('heading', { name: t('step2Title') })).toBeVisible();
  await next(t('step3Title')).click();
  await expect(page.getByLabel(t('occupationsLabel'), { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('heading', { name: t('step2Title') })).toBeVisible();
  await page.getByLabel(t('occupationsLabel'), { exact: true }).fill('Cariste');
  await page.getByLabel(t('occupationsLabel'), { exact: true }).press('Enter');
  await page.getByRole('button', { name: msg('fr', 'categories.logistics'), exact: true }).click();
  await next(t('step3Title')).click();

  // Krok 3: doświadczenie + umiejętności (jedna transakcja, 0082).
  await page.getByLabel(t('experienceLabel'), { exact: true }).fill('5');
  for (const skill of ['Chariot élévateur', 'Chargement']) {
    await page.getByLabel(t('skillsLabel'), { exact: true }).fill(skill);
    await page.getByLabel(t('skillsLabel'), { exact: true }).press('Enter');
  }
  await next(t('step4Title')).click();
  await expect(saved).toBeVisible();

  // Krok 4: lokalizacja.
  await page.getByLabel(t('city'), { exact: true }).fill('Antwerpen');
  await page.getByLabel(t('radiusLabel'), { exact: true }).fill('30');
  await page.getByRole('button', { name: t('catB'), exact: true }).click();
  await next(t('step5Title')).click();

  // Krok 5: języki + certyfikat z datą ważności.
  await page.getByLabel(t('languagesLabel'), { exact: true }).fill('Néerlandais');
  await page.getByRole('button', { name: t('addLanguage'), exact: true }).click();
  await page.getByLabel(t('certificatesLabel'), { exact: true }).fill('VCA');
  await page.getByLabel(t('certificatesLabel'), { exact: true }).press('Enter');
  await page.getByLabel(t('certificateExpiryLabel', { certificate: 'VCA' }), { exact: true }).fill('2031-06-30');
  await next(t('step6Title')).click();

  // Krok 6: dostępność, rodzaj umowy, zgoda → „Terminer et publier”.
  await chooseOption(page, page.locator('#onb-availability-trigger'), t('availImmediate'));
  await page.getByRole('button', { name: msg('fr', 'contractTypes.permanent'), exact: true }).click();
  await page.getByRole('checkbox', { name: richLabel(t('agreeTermsLinks')) }).check();
  await page.getByRole('button', { name: t('finish'), exact: true }).click();
  await page.waitForURL(/\/fr\/candidate$/);

  const [profile] = await candidate.request(async (tx) => rows<Record<string, unknown>>(await tx.query(
    `SELECT p.phone, cp.occupations, cp.experience_years, cp.city, cp.profile_completed, cp.is_searchable,
       (SELECT array_agg(s.skill_label ORDER BY s.skill_label) FROM public.candidate_skills s WHERE s.candidate_profile_id = cp.id) AS skills,
       (SELECT array_agg(c.certificate_label || '@' || coalesce(c.expires_at::text, '-')) FROM public.candidate_certificates c
          WHERE c.candidate_profile_id = cp.id) AS certificates,
       (SELECT count(*)::int FROM public.candidate_languages l WHERE l.candidate_profile_id = cp.id) AS languages
     FROM public.profiles p JOIN public.candidate_profiles cp ON cp.profile_id = p.id WHERE p.id = auth.uid()`)));
  expect(profile).toMatchObject({
    phone: '+32470123456', occupations: ['Cariste'], experience_years: 5, city: 'Antwerpen',
    skills: ['Chargement', 'Chariot élévateur'], certificates: ['VCA@2031-06-30'], languages: 1,
    profile_completed: true, is_searchable: false,
  });
});

test('widoczność profilu: przełącznik w ustawieniach zapisuje stan w bazie', async () => {
  const page = candidatePage;
  await page.goto('/fr/candidate/ustawienia');
  const toggle = page.getByRole('switch', { name: msg('fr', 'profileVisibility.toggleLabel') });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await db(`SELECT cp.is_searchable FROM public.candidate_profiles cp JOIN auth.users u ON u.id = cp.profile_id
    WHERE u.email = $1`, [CANDIDATE_EMAIL])).toEqual([{ is_searchable: true }]);
});

test('aplikowanie przez ApplyModal: podwójne kliknięcie = jedno zgłoszenie (Inv. #4, #11), historia kandydata', async () => {
  const t = (key: string) => msg('fr', `apply.${key}`);
  const page = candidatePage;
  await page.goto(`/fr/oferty-pracy/${JOB_SLUG}`);
  const openAndFill = async () => {
    await page.getByRole('button', { name: msg('fr', 'jobs.applyNow') }).click();
    const dialog = page.getByRole('dialog');
    // Prefiks domyślnie PL (+48) — belgijski numer wymaga wyboru BE.
    await chooseOption(page, dialog.getByRole('combobox', { name: t('dialCode') }), 'BE +32');
    await dialog.locator('#apply-phone').fill('470123456');
    await dialog.getByLabel(t('message'), { exact: true }).fill('Bonjour, je conduis un chariot élévateur depuis 5 ans.');
    await dialog.getByRole('checkbox', { name: t('consent') }).check();
    return dialog;
  };
  const dialog = await openAndFill();
  const submit = dialog.getByRole('button', { name: t('submit'), exact: true });
  // Dwa kliknięcia jedno po drugim: przycisk blokuje się na czas zapisu, klucz idempotencji
  // zostaje ten sam (useRef) — w bazie jedno zgłoszenie.
  await submit.dblclick();
  await expect(page.getByText(t('success'), { exact: true })).toBeVisible();

  const applications = await db<{ id: string; status: string; phone: string }>(
    'SELECT id, status::text, phone FROM public.applications WHERE job_id = $1', [jobId]);
  expect(applications).toEqual([expect.objectContaining({ status: 'submitted', phone: '+32470123456' })]);
  applicationId = applications[0]!.id;

  // Ponowne otwarcie formularza i wysłanie = „już aplikowałeś”, nadal jedno zgłoszenie.
  await page.reload();
  await (await openAndFill()).getByRole('button', { name: t('submit'), exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(t('alreadyApplied'));
  expect(await db('SELECT count(*)::int AS n FROM public.applications WHERE job_id = $1', [jobId])).toEqual([{ n: 1 }]);

  await page.goto('/fr/candidate/aplikacje');
  await expect(page.getByText(JOB_TITLE).first()).toBeVisible();
});

// Panel filtruje po aktywnej firmie sesji niezależnie od RLS (mutacja `rls-applications-off`
// zostawia ten test zielonym) — samą regułę RLS dowodzi critical-flow.spec.ts.
test('obca firma: szczegół zgłoszenia = 404, brak na jej liście (sesja z przeglądarki)', async ({ browser, baseURL }) => {
  const context = await contextWithSession(browser, baseURL!, strangerEmployer.cookie);
  try {
    const page = await context.newPage();
    const response = await page.goto(`/en/employer/aplikacje/${applicationId}`);
    expect(response?.status()).toBe(404);
    await page.goto('/en/employer/aplikacje');
    await expect(page.getByText(JOB_TITLE)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('pracodawca zmienia status w panelu → historia i powiadomienie; kandydat widzi nowy status', async () => {
  const td = (key: string, params?: Record<string, string | number>) => msg('nl', `dashboard.${key}`, params);
  const page = employerPage;
  await page.goto('/nl/employer/aplikacje');
  await page.getByRole('link', { name: td('employerApplicationViewLabel', { name: 'Claire Dubois', job: JOB_TITLE }) }).click();
  await page.waitForURL(`**/nl/employer/aplikacje/${applicationId}`);

  const trigger = (status: string) => page.getByRole('button', {
    name: td('statusMenuTrigger', { name: 'Claire Dubois', job: JOB_TITLE, status: msg('nl', `status.${status}`) }),
  });
  const changeStatus = async (from: string, target: 'viewed' | 'shortlisted') => {
    await trigger(from).click();
    await page.getByRole('button', { name: msg('nl', `status.${target}`), exact: true }).click();
    // Po zapisie trasa się odświeża — etykieta menu niesie już nowy status (z bazy).
    await expect(trigger(target)).toBeVisible();
  };
  await changeStatus('submitted', 'viewed');
  await changeStatus('viewed', 'shortlisted');

  expect(await db<{ status: string }>('SELECT status::text FROM public.applications WHERE id = $1', [applicationId]))
    .toEqual([{ status: 'shortlisted' }]);
  const history = (await db<{ to_status: string }>(
    'SELECT to_status::text FROM public.application_status_history WHERE application_id = $1 ORDER BY created_at', [applicationId]))
    .map((r) => r.to_status);
  expect(history).toEqual(expect.arrayContaining(['viewed', 'shortlisted']));
  expect(await db(
    `SELECT count(*)::int AS n FROM public.notifications n JOIN auth.users u ON u.id = n.profile_id
      WHERE u.email = $1 AND n.entity_id = $2`, [CANDIDATE_EMAIL, applicationId]))
    .not.toEqual([{ n: 0 }]);

  await candidatePage.goto('/fr/candidate/aplikacje');
  await expect(candidatePage.getByText(msg('fr', 'status.shortlisted'), { exact: true }).first()).toBeVisible();
});

test('propozycja z panelu (Inv. #3) i akceptacja w panelu kandydata; stan i powiadomienie pracodawcy w bazie', async () => {
  // Pipeline materializacji dopasowań nie istnieje (P1-03) — operator zapisuje wynik scoreMatch.
  await stack.admin.query(
    `INSERT INTO public.matches (candidate_id, job_id, score, summary_key)
     SELECT u.id, $2, 87, 'good' FROM auth.users u WHERE u.email = $1`, [CANDIDATE_EMAIL, jobId]);

  const td = (key: string, params?: Record<string, string | number>) => msg('nl', `dashboard.${key}`, params);
  const page = employerPage;
  await page.goto('/nl/employer/kandydaci');
  await page.getByRole('button', { name: td('sendOfferTo', { name: 'Claire Dubois', job: JOB_TITLE }) }).click();
  await page.getByRole('dialog').getByRole('button', { name: td('sendOffer'), exact: true }).dblclick();
  await expect(page.getByText(td('offerSentSuccess'), { exact: true })).toBeVisible();

  const offers = await db<{ id: string; status: string }>('SELECT id, status::text FROM public.offers WHERE job_id = $1', [jobId]);
  expect(offers).toEqual([expect.objectContaining({ status: 'sent' })]);
  offerId = offers[0]!.id;
  expect(await db("SELECT count(*)::int AS n FROM public.email_deliveries WHERE template = 'jobOffer' AND entity_id = $1", [offerId]))
    .toEqual([{ n: 1 }]);

  // Kandydat: /fr/candidate/propozycje → „Accepter la proposition”.
  await candidatePage.goto('/fr/candidate/propozycje');
  await candidatePage.getByRole('button', { name: msg('fr', 'dashboard.acceptProposal'), exact: true }).click();
  await expect(candidatePage.getByRole('status').filter({ hasText: msg('fr', 'dashboard.acceptProposalSuccess') })).toBeVisible();
  expect(await db('SELECT status::text FROM public.offers WHERE id = $1', [offerId])).toEqual([{ status: 'accepted' }]);
  expect(await db(
    `SELECT count(*)::int AS n FROM public.notifications n JOIN auth.users u ON u.id = n.profile_id
      WHERE u.email = $1 AND n.entity_id = $2`, [EMPLOYER_EMAIL, offerId])).not.toEqual([{ n: 0 }]);
});

test('wiadomości w obu panelach: wysyłka, odczyt po drugiej stronie, odpowiedź; dwie wiadomości w bazie', async () => {
  const td = (key: string, params?: Record<string, string | number>) => msg('nl', `dashboard.${key}`, params);
  const page = employerPage;
  await page.goto(`/nl/employer/aplikacje/${applicationId}`);
  await page.getByRole('button', { name: td('employerApplicationMessageLabel', { name: 'Claire Dubois' }) }).click();
  await page.waitForURL(/\/nl\/employer\/wiadomosci\?c=/);
  const conversationId = new URL(page.url()).searchParams.get('c')!;

  // Lista wiadomości wątku (nie podgląd na liście rozmów).
  const employerThread = page.getByRole('list', { name: msg('nl', 'messages.threadListLabel', { name: 'Claire Dubois' }) });
  await page.getByRole('textbox', { name: msg('nl', 'messages.composerLabel', { name: 'Claire Dubois' }) }).fill(MESSAGE_TO_CANDIDATE);
  await page.getByRole('button', { name: msg('nl', 'messages.send'), exact: true }).click();
  await expect(employerThread.getByText(MESSAGE_TO_CANDIDATE, { exact: true })).toBeVisible();

  // Kandydat: nazwy firmy w wątku kandydat nie widzi pod RLS (otwarte w CLAUDE.md, od 0014) —
  // nazwę kontrolek dopasowujemy więc tylko po stałym początku etykiety.
  const prefix = (key: string) => new RegExp(`^${msg('fr', key, { name: '' })}`);
  await candidatePage.goto(`/fr/candidate/wiadomosci?c=${conversationId}`);
  const candidateThread = candidatePage.getByRole('list', { name: prefix('messages.threadListLabel') });
  await expect(candidateThread.getByText(MESSAGE_TO_CANDIDATE, { exact: true })).toBeVisible();
  await candidatePage.getByRole('textbox', { name: prefix('messages.composerLabel') }).fill(MESSAGE_TO_EMPLOYER);
  await candidatePage.getByRole('button', { name: msg('fr', 'messages.send'), exact: true }).click();
  await expect(candidateThread.getByText(MESSAGE_TO_EMPLOYER, { exact: true })).toBeVisible();

  await page.reload();
  await expect(employerThread.getByText(MESSAGE_TO_EMPLOYER, { exact: true })).toBeVisible();
  expect(await db<{ body: string }>('SELECT body FROM public.messages WHERE conversation_id = $1 ORDER BY created_at', [conversationId]))
    .toEqual([{ body: MESSAGE_TO_CANDIDATE }, { body: MESSAGE_TO_EMPLOYER }]);
});

test('e-maile z przepływu UI w języku odbiorcy (Inv. #1): kandydat fr, pracodawca nl', async () => {
  const deliveries = await db<{ email: string; template: string; locale: string }>(
    `SELECT u.email, d.template, d.locale FROM public.email_deliveries d JOIN auth.users u ON u.id = d.profile_id
      WHERE u.email = ANY($1)`, [[CANDIDATE_EMAIL, EMPLOYER_EMAIL]]);
  const of = (email: string) => deliveries.filter((d) => d.email === email);
  expect(new Set(of(CANDIDATE_EMAIL).map((d) => d.locale))).toEqual(new Set(['fr']));
  expect(new Set(of(EMPLOYER_EMAIL).map((d) => d.locale))).toEqual(new Set(['nl']));
  expect(of(CANDIDATE_EMAIL).map((d) => d.template)).toEqual(expect.arrayContaining(['statusChanged', 'jobOffer', 'newMessage']));
  expect(of(EMPLOYER_EMAIL).map((d) => d.template)).toEqual(expect.arrayContaining(['newApplication', 'offerAccepted', 'newMessage']));
});
