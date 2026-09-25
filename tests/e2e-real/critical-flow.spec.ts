import { expect, test, type Browser } from '@playwright/test';
import {
  createStack,
  expectDomainError,
  rows,
  rpc,
  rpcRows,
  uuid,
  type Actor,
  type Stack,
} from './support/stack';

/**
 * Przepływ kandydat ↔ pracodawca (§9, #351) i onboarding kandydata (#66) na PRAWDZIWYM
 * PostgreSQL 16 z migracjami produkcyjnymi — nie w trybie demo.
 *
 * Sesje: Better Auth (rejestracja → weryfikacja e-mail → logowanie → cookie). Każda operacja
 * domenowa to osobne „żądanie”: serwer odczytuje tożsamość z cookie (readPortalIdentity),
 * a zapytania wykonuje withUserTransaction na ograniczonym loginie aplikacji pod RLS.
 * Test nie przekazuje żadnego userId: identyfikatory drugiej strony (kandydat, aplikacja)
 * pracodawca czyta z własnego widoku, tak jak panel.
 *
 * Przeglądarka: strony publiczne oferty czytają z tej samej bazy (DATABASE_APP_URL).
 * Tu „widok” panelu = zapytanie pod sesją i RLS (reguły bazy, kontrole ujemne, wyścigi);
 * te same kroki klikane w panelach i Server Actions — ui-flow.spec.ts.
 */

/** Kontrola ujemna po stronie klienta: ponowienie z NOWYM kluczem (regresja useRef w ApplyModal). */
const retryKey = (key: string) => (process.env.E2E_REAL_MUTATION === 'retry-new-key' ? uuid() : key);

const run = Math.random().toString(36).slice(2, 8);
const JOB_TITLE = `Magazynier nocny E2E ${run}`;
const JOB_SLUG = `magazynier-nocny-e2e-${run}`;

let stack: Stack;
let employer: Actor; // nl, firma zweryfikowana
let candidate: Actor; // fr
let otherEmployer: Actor; // inna firma — kontrola ujemna
let otherCandidate: Actor; // inny kandydat — kontrola ujemna
let admin: Actor;
let jobId: string;
let companyId: string;
let applicationId: string;
let offerId: string;
let conversationId: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  stack = await createStack();
});

test.afterAll(async () => {
  await stack?.close();
});

async function verifyCompany(owner: Actor, name: string): Promise<string> {
  const [created] = await owner.request((tx) => rpcRows<{ company_id: string; created: boolean }>(
    tx, 'create_first_company', { p_name: name, p_slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run}` }));
  expect(created?.created).toBe(true);
  const companyId = created!.company_id;
  await admin.request((tx) => rpc(tx, 'admin_set_company_status', { p_company_id: companyId, p_status: 'verified' }));
  return companyId;
}

async function publicJobStatus(browser: Browser, locale: string): Promise<number> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const response = await page.goto(`/${locale}/oferty-pracy/${JOB_SLUG}`);
    return response?.status() ?? 0;
  } finally {
    await context.close();
  }
}

test('konta: prawdziwe sesje Better Auth, tożsamość tylko z cookie', async () => {
  employer = await stack.signUpEmployer(`employer-nl-${run}@e2e.invalid`, 'nl', ['Jan', 'Peeters'], 'Logistiek NV');
  candidate = await stack.signUpCandidate(`candidate-fr-${run}@e2e.invalid`, 'fr', ['Claire', 'Dubois']);
  otherEmployer = await stack.signUpEmployer(`employer-en-${run}@e2e.invalid`, 'en', ['Tom', 'Smith'], 'Other Ltd');
  otherCandidate = await stack.signUpCandidate(`candidate-pl-${run}@e2e.invalid`, 'pl', ['Anna', 'Nowak']);
  const adminAccount = await stack.signUpCandidate(`admin-${run}@e2e.invalid`, 'en', ['Ada', 'Admin']);
  // Rolę administratora nadaje operator bazy (nie ma ścieżki samodzielnej rejestracji admina).
  await stack.admin.query("UPDATE public.profiles SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = $1)",
    [adminAccount.email]);
  admin = adminAccount;

  expect((await employer.identity())?.role).toBe('employer');
  expect((await candidate.identity())?.role).toBe('candidate');
  expect((await admin.identity())?.role).toBe('admin');
  // Język odbiorcy zapisany przy rejestracji (Invariant #1 — źródło fallbacku).
  const locales = rows<{ email: string; preferred_locale: string }>(await stack.admin.query(
    `SELECT u.email, p.preferred_locale FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE u.email = ANY($1)`, [[employer.email, candidate.email]]));
  expect(Object.fromEntries(locales.map((r) => [r.email, r.preferred_locale])))
    .toEqual({ [employer.email]: 'nl', [candidate.email]: 'fr' });

  // Kontrola ujemna: sfałszowane cookie nie daje tożsamości ani dostępu do danych.
  const forged = stack.actorFromCookie('forged', '__Secure-better-auth.session_token=forged');
  expect(await forged.identity()).toBeNull();
  await expectDomainError(forged.request(async () => 'never'), 'UNAUTHENTICATED');
});

test('pracodawca: firma zweryfikowana, szkic i publikacja; oferta widoczna publicznie z bazy', async ({ page }) => {
  companyId = await verifyCompany(employer, 'Logistiek NV');
  await verifyCompany(otherEmployer, 'Other Ltd');

  jobId = await employer.request(async (tx) => {
    // Jak createJobDraft + kroki kreatora: szkic pod RLS, treść, tłumaczenie, wymagania, publikacja.
    const [draft] = rows<{ id: string }>(await tx.query(
      `INSERT INTO public.jobs (company_id, created_by, slug, default_locale, title, status, category,
         contract_type, city, region)
       VALUES ($1, auth.uid(), $2, 'nl', $3, 'draft', 'logistics', 'permanent', 'Antwerpen', 'Vlaanderen')
       RETURNING id`, [companyId, `draft-${uuid()}`, JOB_TITLE]));
    await tx.query(
      `INSERT INTO public.job_translations (job_id, locale, title, description, responsibilities)
       VALUES ($1, 'nl', $2, 'Nachtploeg in een distributiecentrum in Antwerpen.', ARRAY['Orders verzamelen', 'Heftruck besturen'])`,
      [draft!.id, JOB_TITLE]);
    await rpc(tx, 'set_job_requirements', {
      p_job_id: draft!.id, p_locale: 'nl', p_kind: 'mandatory', p_lines: ['Heftruckattest'],
    });
    await rpc(tx, 'publish_job', { p_job_id: draft!.id, p_slug: JOB_SLUG });
    return draft!.id;
  });

  // Przeglądarka gościa: szczegół oferty renderowany z PostgreSQL, bez banera danych demo.
  const response = await page.goto(`/fr/oferty-pracy/${JOB_SLUG}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: JOB_TITLE })).toBeVisible();
  await expect(page.getByTestId('demo-jobs-notice')).toHaveCount(0);
});

/** Liczniki lejka (#99) oferty na dziś — odczyt operatora bazy (agregat nie ma dostępu klienta). */
async function funnelToday(): Promise<{ detail_views: number; apply_started: number; search_appearances: number }> {
  const [row] = rows<{ detail_views: number; apply_started: number; search_appearances: number }>(await stack.admin.query(
    `SELECT detail_views, apply_started, search_appearances FROM public.job_funnel_daily
      WHERE job_id = $1 AND day = (now() AT TIME ZONE 'Europe/Brussels')::date`, [jobId]));
  return row ?? { detail_views: 0, apply_started: 0, search_appearances: 0 };
}

test('lejek ofert (#99): wyświetlenie, „Aplikuj” i wyniki listy liczone serwerowo, bez cookies; bot pominięty', async ({ browser }) => {
  const start = await funnelToday();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const beacons: { body: Record<string, unknown>; cookie: string | undefined }[] = [];
    page.on('request', (req) => {
      if (req.url().endsWith('/api/job-funnel')) {
        beacons.push({ body: req.postDataJSON() as Record<string, unknown>, cookie: req.headers()['cookie'] });
      }
    });

    const view = page.waitForResponse((res) => res.url().endsWith('/api/job-funnel') && res.status() === 204);
    await page.goto(`/fr/oferty-pracy/${JOB_SLUG}`);
    await view;
    await expect.poll(async () => (await funnelToday()).detail_views).toBe(start.detail_views + 1);

    // Otwarcie formularza „Aplikuj” (także jako gość) — raz na wyświetlenie oferty.
    const started = page.waitForResponse((res) => res.url().endsWith('/api/job-funnel') && res.status() === 204);
    await page.getByRole('button', { name: /Postuler maintenant/ }).click();
    await started;
    await expect.poll(async () => (await funnelToday()).apply_started).toBe(start.apply_started + 1);

    // Odświeżenie = nowe wyświetlenie (udokumentowana reguła), zdarzenia bez cookies i danych osób.
    const refreshed = page.waitForResponse((res) => res.url().endsWith('/api/job-funnel') && res.status() === 204);
    await page.reload();
    await refreshed;
    await expect.poll(async () => (await funnelToday()).detail_views).toBe(start.detail_views + 2);

    // Wyniki listy: oferta pokazana na liście liczy się jako pojawienie w wynikach.
    const listed = page.waitForResponse((res) => res.url().endsWith('/api/job-funnel') && res.status() === 204);
    await page.goto('/fr/oferty-pracy');
    await listed;
    await expect.poll(async () => (await funnelToday()).search_appearances).toBe(start.search_appearances + 1);

    expect(beacons.length).toBeGreaterThanOrEqual(4);
    for (const beacon of beacons) {
      expect(beacon.cookie).toBeUndefined();
      expect(Object.keys(beacon.body).sort()).toEqual(['event', 'jobIds', 'nonce']);
    }
    // Endpoint lejka nie ustawia cookies (jedyne cookie kontekstu to język strony z next-intl).
    for (const response of [await view, await started, await refreshed, await listed]) {
      expect(await response.headerValue('set-cookie')).toBeNull();
    }
    expect((await context.cookies()).map((cookie) => cookie.name).filter((name) => name !== 'NEXT_LOCALE')).toEqual([]);
  } finally {
    await context.close();
  }

  // Ponowienie tego samego zgłoszenia (ten sam nonce) nie dubluje zliczenia; robot nie jest liczony.
  const api = await browser.newContext();
  try {
    const nonce = uuid();
    const send = (userAgent: string) => api.request.post('/api/job-funnel', {
      data: { event: 'detail_view', nonce, jobIds: [jobId] },
      headers: { 'user-agent': userAgent, 'sec-fetch-site': 'same-origin' },
    });
    const before = (await funnelToday()).detail_views;
    const browserUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
    expect((await send(browserUa)).status()).toBe(204);
    expect((await send(browserUa)).status()).toBe(204);
    expect((await send('Mozilla/5.0 (compatible; Googlebot/2.1)')).status()).toBe(204);
    expect((await funnelToday()).detail_views).toBe(before + 1);
  } finally {
    await api.close();
  }

  // Panel: pracodawca (recruiter+) widzi lejek swojej oferty; inna firma nie ma dostępu.
  const today = rows<{ d: string }>(await stack.admin.query(
    "SELECT to_char((now() AT TIME ZONE 'Europe/Brussels')::date, 'YYYY-MM-DD') AS d"))[0]!.d;
  const [mine] = (await employer.request((tx) => rpcRows<{ job_id: string; detail_views: string; apply_started: string }>(
    tx, 'get_company_job_funnel', { p_company_id: companyId, p_from: today, p_to: today })))
    .filter((row) => row.job_id === jobId);
  expect(Number(mine?.detail_views)).toBe(start.detail_views + 3);
  expect(Number(mine?.apply_started)).toBe(start.apply_started + 1);
  await expectDomainError(otherEmployer.request((tx) => rpcRows(
    tx, 'get_company_job_funnel', { p_company_id: companyId, p_from: today, p_to: today })), 'PERMISSION_DENIED');
});

test('onboarding kandydata (#66): kroki 1–6, błąd kroku 5 nie narusza zapisanych danych, finish_onboarding', async () => {
  // Krok 1 (profil) i 2 (zawody) — zapis pod sesją, właściciel wiersza = auth.uid() z cookie.
  await candidate.request((tx) => tx.query(
    "UPDATE public.profiles SET first_name = 'Claire', last_name = 'Dubois', phone = '+32470123456' WHERE id = auth.uid()"));
  const upsertCandidate = (columns: Record<string, unknown>) => candidate.request((tx) => {
    const names = Object.keys(columns);
    return tx.query(
      `INSERT INTO public.candidate_profiles (profile_id, ${names.join(', ')})
       VALUES (auth.uid(), ${names.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (profile_id) DO UPDATE SET ${names.map((n) => `${n} = EXCLUDED.${n}`).join(', ')}`,
      Object.values(columns));
  });
  await upsertCandidate({ occupations: ['Magasinier'], categories: ['logistics'] });
  // Krok 3: doświadczenie + umiejętności w jednej transakcji (0082).
  await candidate.request((tx) => rpc(tx, 'save_candidate_onboarding_step3', {
    p_experience_years: 4, p_skills: ['Chariot élévateur', 'Préparation de commandes'],
  }));
  await upsertCandidate({ city: 'Antwerpen', region: 'Vlaanderen', radius_km: 30, has_driving_license: true, has_car: false });
  // Krok 5: języki + certyfikaty w jednej transakcji.
  await candidate.request((tx) => rpc(tx, 'save_candidate_onboarding_step5', {
    p_languages: JSON.stringify([{ language: 'fr', level: 'native' }, { language: 'nl', level: 'basic' }]),
    p_certificates: JSON.stringify([{ label: 'Heftruckattest', expires_at: '2031-06-30' }]),
  }));

  const readProfile = () => candidate.request(async (tx) => {
    const [profile] = rows<Record<string, unknown>>(await tx.query(
      `SELECT p.first_name, p.phone, cp.experience_years, cp.city, cp.profile_completed,
         (SELECT array_agg(cs.skill_label ORDER BY cs.skill_label) FROM public.candidate_skills cs
            WHERE cs.candidate_profile_id = cp.id) AS skills,
         (SELECT array_agg(cl.language_label || ':' || cl.level ORDER BY cl.language_label) FROM public.candidate_languages cl
            WHERE cl.candidate_profile_id = cp.id) AS languages,
         (SELECT array_agg(cc.certificate_label || '@' || coalesce(cc.expires_at::text, '-') ORDER BY cc.certificate_label)
            FROM public.candidate_certificates cc WHERE cc.candidate_profile_id = cp.id) AS certificates
       FROM public.profiles p JOIN public.candidate_profiles cp ON cp.profile_id = p.id WHERE p.id = auth.uid()`));
    if (!profile) throw new Error('Brak profilu kandydata.');
    return profile;
  });
  const saved = await readProfile();
  expect(saved).toMatchObject({
    first_name: 'Claire', phone: '+32470123456', experience_years: 4, city: 'Antwerpen',
    skills: ['Chariot élévateur', 'Préparation de commandes'],
    languages: ['fr:native', 'nl:basic'],
    certificates: ['Heftruckattest@2031-06-30'],
    profile_completed: false,
  });

  // Kontrolowany błąd DRUGIEJ części kroku 5 (data certyfikatu): cały krok się cofa (#142).
  await expectDomainError(candidate.request((tx) => rpc(tx, 'save_candidate_onboarding_step5', {
    p_languages: JSON.stringify([{ language: 'en', level: 'fluent' }]),
    p_certificates: JSON.stringify([{ label: 'VCA', expires_at: 'not-a-date' }]),
  })), /invalid input syntax|VALIDATION_FAILED/);
  // „Reload”: nowe żądanie, nowa transakcja — wcześniejsze kroki i oba zakresy kroku 5 bez zmian.
  expect(await readProfile()).toEqual(saved);

  // Kontrola ujemna: bez finalizacji profil NIE jest ukończony (brak pozornego sukcesu).
  expect(saved.profile_completed).toBe(false);
  // Krok 6 + finish_onboarding (kompletność liczy baza).
  await upsertCandidate({ availability: 'immediate', preferred_contract_types: ['permanent'], bio: 'Magasinière de nuit.' });
  expect(await candidate.request((tx) => rpc<boolean>(tx, 'finish_onboarding'))).toBe(true);
  expect((await readProfile()).profile_completed).toBe(true);

  // Klient nie może sam oznaczyć profilu jako ukończony (guard 0029): INSERT zeruje flagę,
  // UPDATE jest odrzucany — ukończenie wyłącznie przez finish_onboarding.
  await otherCandidate.request((tx) => tx.query(
    'INSERT INTO public.candidate_profiles (profile_id, profile_completed) VALUES (auth.uid(), true)'));
  await expectDomainError(otherCandidate.request((tx) => tx.query(
    'UPDATE public.candidate_profiles SET profile_completed = true WHERE profile_id = auth.uid()')), 'PERMISSION_DENIED');
  expect(rows(await otherCandidate.request((tx) => tx.query(
    'SELECT profile_completed FROM public.candidate_profiles WHERE profile_id = auth.uid()'))))
    .toEqual([{ profile_completed: false }]);
});

test('aplikacja: podwójne kliknięcie = jedna aplikacja (Inv. #4), widok obu stron i RLS', async () => {
  const key = uuid();
  const apply = (idempotencyKey: string) => candidate.request((tx) => rpc<string>(tx, 'apply_to_job', {
    p_job_id: jobId, p_idempotency_key: idempotencyKey, p_phone: '+32470123456',
    p_availability: 'immediate', p_message: 'Bonjour, je suis disponible de nuit.',
  }));
  // Podwójne kliknięcie: dwa równoległe żądania z tym samym kluczem.
  const [first, second] = await Promise.all([apply(key), apply(retryKey(key))]);
  expect(second).toBe(first);
  applicationId = first;
  // Ponowienie po utracie odpowiedzi (ten sam klucz) = ten sam wynik.
  expect(await apply(retryKey(key))).toBe(applicationId);
  // Kontrola ujemna: nowy klucz dla tej samej pary nie tworzy drugiej aplikacji.
  await expectDomainError(apply(uuid()), 'APPLICATION_ALREADY_EXISTS');
  expect(rows(await stack.admin.query(
    'SELECT count(*)::int AS n FROM public.applications WHERE job_id = $1', [jobId]))).toEqual([{ n: 1 }]);

  // Widok kandydata (/fr/candidate/aplikacje): status „submitted”.
  const mine = await candidate.request((tx) => tx.query('SELECT id, status::text FROM public.applications'));
  expect(rows(mine)).toEqual([{ id: applicationId, status: 'submitted' }]);

  // Widok pracodawcy (/nl/employer/aplikacje) + powiadomienie in-app o nowym zgłoszeniu.
  const inbox = await employer.request(async (tx) => ({
    apps: rows(await tx.query('SELECT id, status::text FROM public.applications WHERE job_id = $1', [jobId])),
    alerts: rows(await tx.query(
      "SELECT type::text FROM public.notifications WHERE profile_id = auth.uid() AND entity_id = $1", [applicationId])),
  }));
  expect(inbox.apps).toEqual([{ id: applicationId, status: 'submitted' }]);
  expect(inbox.alerts.length).toBeGreaterThan(0);

  // Kontrole ujemne: inny kandydat i inna firma nie widzą zgłoszenia.
  for (const stranger of [otherCandidate, otherEmployer]) {
    expect(rows(await stranger.request((tx) => tx.query('SELECT id FROM public.applications WHERE id = $1', [applicationId]))))
      .toEqual([]);
  }
});

test('zmiana statusu przez pracodawcę widoczna u kandydata, z powiadomieniem; obca firma odrzucona', async () => {
  await employer.request((tx) => rpc(tx, 'transition_application', { p_application_id: applicationId, p_target: 'viewed' }));
  await employer.request((tx) => rpc(tx, 'transition_application', { p_application_id: applicationId, p_target: 'shortlisted' }));

  const view = await candidate.request(async (tx) => ({
    status: rows<{ status: string }>(await tx.query('SELECT status::text FROM public.applications WHERE id = $1', [applicationId]))[0]?.status,
    unread: rows<{ n: number }>(await tx.query(
      'SELECT count(*)::int AS n FROM public.notifications WHERE profile_id = auth.uid() AND entity_id = $1 AND read_at IS NULL',
      [applicationId]))[0]?.n,
    history: rows<{ to_status: string }>(await tx.query(
      'SELECT to_status::text FROM public.application_status_history WHERE application_id = $1 ORDER BY created_at', [applicationId]))
      .map((r) => r.to_status),
  }));
  expect(view.status).toBe('shortlisted');
  expect(view.unread).toBeGreaterThan(0);
  expect(view.history).toEqual(expect.arrayContaining(['viewed', 'shortlisted']));

  await expectDomainError(otherEmployer.request((tx) => rpc(tx, 'transition_application', {
    p_application_id: applicationId, p_target: 'rejected' })), /PERMISSION_DENIED|NOT_FOUND/);
  await expectDomainError(candidate.request((tx) => rpc(tx, 'transition_application', {
    p_application_id: applicationId, p_target: 'hired' })), /PERMISSION_DENIED|NOT_FOUND/);
  expect(rows(await stack.admin.query('SELECT status::text FROM public.applications WHERE id = $1', [applicationId])))
    .toEqual([{ status: 'shortlisted' }]);
});

test('propozycja: retry bez duplikatu (Inv. #3), akceptacja kandydata widoczna u pracodawcy', async () => {
  const key = uuid();
  // Pracodawca bierze kandydata z własnego widoku zgłoszenia — nie z testu.
  const send = (idempotencyKey: string) => employer.request(async (tx) => {
    const [app] = rows<{ candidate_id: string }>(await tx.query(
      'SELECT candidate_id FROM public.applications WHERE id = $1', [applicationId]));
    return rpc<string>(tx, 'send_offer', {
      p_job_id: jobId, p_candidate_id: app!.candidate_id, p_idempotency_key: idempotencyKey, p_message: null,
    });
  });
  offerId = await send(key);
  expect(await send(retryKey(key))).toBe(offerId);
  // Nowy klucz przy aktywnej propozycji dla tej pary — ta sama propozycja, bez drugiego e-maila.
  expect(await send(uuid())).toBe(offerId);
  const counts = rows<{ offers: number; mails: number }>(await stack.admin.query(
    `SELECT (SELECT count(*)::int FROM public.offers WHERE job_id = $1) AS offers,
            (SELECT count(*)::int FROM public.email_deliveries WHERE template = 'jobOffer' AND entity_id = $2) AS mails`,
    [jobId, offerId]))[0]!;
  expect(counts).toEqual({ offers: 1, mails: 1 });

  // Kandydat (/fr/candidate/propozycje) widzi „sent” i akceptuje.
  expect(rows(await candidate.request((tx) => tx.query('SELECT id, status::text FROM public.offers'))))
    .toEqual([{ id: offerId, status: 'sent' }]);
  await expectDomainError(otherCandidate.request((tx) => rpc(tx, 'respond_to_offer', { p_offer_id: offerId, p_accept: false })),
    /PERMISSION_DENIED|NOT_FOUND|VALIDATION_FAILED/);
  await candidate.request((tx) => rpc(tx, 'respond_to_offer', { p_offer_id: offerId, p_accept: true }));

  const employerView = await employer.request(async (tx) => ({
    offer: rows(await tx.query('SELECT status::text FROM public.offers WHERE id = $1', [offerId])),
    alerts: rows<{ n: number }>(await tx.query(
      'SELECT count(*)::int AS n FROM public.notifications WHERE profile_id = auth.uid() AND entity_id = $1', [offerId]))[0]?.n,
  }));
  expect(employerView.offer).toEqual([{ status: 'accepted' }]);
  expect(employerView.alerts).toBeGreaterThan(0);
  expect(rows(await otherEmployer.request((tx) => tx.query('SELECT id FROM public.offers WHERE id = $1', [offerId]))))
    .toEqual([]);
});

test('wiadomości w obie strony, licznik nieprzeczytanych; obce konta bez dostępu', async () => {
  conversationId = await employer.request((tx) => rpc<string>(tx, 'get_or_create_conversation', {
    p_application_id: applicationId, p_offer_id: null }));
  const clientMessageId = uuid();
  const say = (actor: Actor, body: string, id: string) =>
    actor.request((tx) => rpc<string>(tx, 'send_message', { p_conversation_id: conversationId, p_body: body, p_client_message_id: id }));
  const first = await say(employer, 'Goedendag Claire, wanneer kunt u starten?', clientMessageId);
  // Ponowienie po zerwanym połączeniu (ten sam client_message_id) — ta sama wiadomość.
  expect(await say(employer, 'Goedendag Claire, wanneer kunt u starten?', retryKey(clientMessageId))).toBe(first);

  const unread = (actor: Actor) => actor.request(async (tx) =>
    (await rpcRows<{ conversation_id: string; unread_count: string }>(tx, 'get_conversation_summaries'))
      .filter((s) => s.conversation_id === conversationId).map((s) => Number(s.unread_count)));
  expect(await unread(candidate)).toEqual([1]);

  await say(candidate, 'Bonjour, dès lundi.', uuid());
  expect(await unread(employer)).toEqual([1]);
  await candidate.request((tx) => rpc(tx, 'mark_conversation_read', { p_conversation_id: conversationId }));
  expect(await unread(candidate)).toEqual([0]);

  expect(rows(await stack.admin.query(
    'SELECT count(*)::int AS n FROM public.messages WHERE conversation_id = $1', [conversationId]))).toEqual([{ n: 2 }]);

  // Kontrole ujemne: obca firma i inny kandydat nie widzą rozmowy ani do niej nie piszą.
  for (const stranger of [otherEmployer, otherCandidate]) {
    expect(rows(await stranger.request((tx) => tx.query('SELECT id FROM public.conversations WHERE id = $1', [conversationId]))))
      .toEqual([]);
    expect(await unread(stranger)).toEqual([]);
    await expectDomainError(say(stranger, 'spam', uuid()), /PERMISSION_DENIED|NOT_FOUND/);
  }
  await expectDomainError(otherCandidate.request((tx) => rpc(tx, 'get_or_create_conversation', {
    p_application_id: applicationId, p_offer_id: null })), /PERMISSION_DENIED|NOT_FOUND/);
});

test('e-maile w języku odbiorcy (Inv. #1): kandydat fr, pracodawca nl', async () => {
  const deliveries = rows<{ email: string; template: string; locale: string }>(await stack.admin.query(
    `SELECT u.email, d.template, d.locale FROM public.email_deliveries d JOIN auth.users u ON u.id = d.profile_id
     WHERE u.email = ANY($1) ORDER BY d.created_at`, [[candidate.email, employer.email]]));
  const byRecipient = (email: string) => deliveries.filter((d) => d.email === email);
  const candidateMail = byRecipient(candidate.email);
  const employerMail = byRecipient(employer.email);
  expect(new Set(candidateMail.map((d) => d.locale))).toEqual(new Set(['fr']));
  expect(new Set(employerMail.map((d) => d.locale))).toEqual(new Set(['nl']));
  expect(candidateMail.map((d) => d.template)).toEqual(expect.arrayContaining(['applicationViewed', 'jobOffer', 'newMessage']));
  expect(employerMail.map((d) => d.template)).toEqual(expect.arrayContaining(['newApplication', 'offerAccepted', 'newMessage']));
});

test('zamknięcie oferty: znika ze strony publicznej, historia kandydata zostaje', async ({ browser }) => {
  expect(await publicJobStatus(browser, 'nl')).toBe(200);
  await employer.request((tx) => rpc(tx, 'set_job_status', { p_job_id: jobId, p_action: 'close' }));
  expect(await publicJobStatus(browser, 'nl')).toBe(404);
  expect(rows(await candidate.request((tx) => tx.query('SELECT id FROM public.applications WHERE id = $1', [applicationId]))))
    .toEqual([{ id: applicationId }]);
});
