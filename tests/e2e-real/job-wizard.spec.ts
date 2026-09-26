import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createStack, rows, rpc, rpcRows, type Actor, type Stack } from './support/stack';
import { chooseOption, contextWithSession, msg } from './support/ui';

/**
 * Kreator oferty (9 kroków) KLIKANY W PRZEGLĄDARCE na PostgreSQL 16 z migracjami produkcyjnymi
 * (CLAUDE.md, Etap 8 — „kreator oferty w przebiegu real-flow”). Pracodawca (nl) ma sesję
 * Better Auth w przeglądarce; każdy krok idzie przez Server Action `updateJobDraft` →
 * `save_job_draft` pod RLS, a po każdym „Volgende” operator CZYTA szkic w bazie:
 * - błąd pola w kroku 1 zatrzymuje kreator i nie tworzy wiersza oferty;
 * - kroki 1–9 zapisują kolumny `jobs`, tłumaczenie i relacje (wymagania, umiejętności,
 *   języki, certyfikaty) — oferta zostaje szkicem;
 * - „Vacature publiceren” przy firmie niezweryfikowanej: komunikat, oferta nadal `draft`,
 *   brak publicznej strony;
 * - po weryfikacji firmy przez administratora (RPC pod jego sesją — brak innej ścieżki UI)
 *   ta sama sesja kreatora publikuje: `active`, slug publiczny, strona oferty dla gościa.
 *
 * Kontrole ujemne (scripts/test-e2e-real.mjs): `wizard-draft-noop` (zapis kroku zwraca
 * sukces bez zmian w bazie) i `publish-unverified` (publikacja bez sprawdzenia weryfikacji
 * firmy) — każda daje czerwony test.
 */

const run = Math.random().toString(36).slice(2, 8);
const LOCALE = 'nl' as const;
const COMPANY = `Wizard Logistiek ${run}`;
const TITLE = `Orderpicker wizard ${run}`;
const t = (key: string, params?: Record<string, string | number>) => msg(LOCALE, `jobWizard.${key}`, params);

let stack: Stack;
let admin: Actor;
let employer: Actor;
let context: BrowserContext;
let page: Page;
let companyId: string;
let jobId: string;

test.describe.configure({ mode: 'serial' });

const db = async <T>(sql: string, params: unknown[] = []) => rows<T>(await stack.admin.query(sql, params));

async function companyJobs(): Promise<Array<{ id: string; status: string; slug: string }>> {
  return db(`SELECT id, status::text, slug FROM public.jobs WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]);
}

async function draft(): Promise<Record<string, unknown>> {
  const [job] = await db<Record<string, unknown>>(`SELECT * FROM public.jobs WHERE id = $1`, [jobId]);
  if (!job) throw new Error('Brak szkicu oferty.');
  return job;
}

async function translation(): Promise<Record<string, unknown> | undefined> {
  const [row] = await db<Record<string, unknown>>(
    `SELECT title, description, responsibilities, conditions, benefits, company_description
       FROM public.job_translations WHERE job_id = $1 AND locale = $2`, [jobId, LOCALE]);
  return row;
}

const next = () => page.getByRole('button', { name: t('next'), exact: true });

async function nextStep(to: number): Promise<void> {
  await next().click();
  await expect(page.getByRole('heading', { level: 2, name: t(`step${to}Title`) })).toBeVisible();
}

async function addChip(label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.locator('..').getByRole('button', { name: t('add'), exact: true }).click();
  await expect(page.getByRole('button', { name: `${t('remove')}: ${value}`, exact: true })).toBeVisible();
}

test.beforeAll(async ({ browser, baseURL }) => {
  stack = await createStack();
  // Konto i sesja przez Better Auth (rejestracja formularzem ma własny scenariusz w ui-flow).
  employer = await stack.signUpEmployer(`wizard-employer-${run}@e2e.invalid`, LOCALE, ['Lotte', 'Janssens'], COMPANY);
  const [company] = await employer.request((tx) => rpcRows<{ company_id: string }>(
    tx, 'create_first_company', { p_name: COMPANY, p_slug: `wizard-logistiek-${run}` }));
  companyId = company!.company_id;
  admin = await stack.signUpCandidate(`wizard-admin-${run}@e2e.invalid`, 'en', ['Ada', 'Admin']);
  await stack.admin.query(
    "UPDATE public.profiles SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = $1)", [admin.email]);

  context = await contextWithSession(browser, baseURL!, employer.cookie);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await stack?.close();
});

test('kroki 1–9: błąd pola bez zapisu, potem każdy krok zapisuje szkic w bazie', async () => {
  test.setTimeout(420_000);
  expect((await db<{ status: string }>(`SELECT status::text FROM public.companies WHERE id = $1`, [companyId]))[0])
    .toEqual({ status: 'unverified' });

  await page.goto(`/${LOCALE}/employer/oferty/nowa`);
  const reject = page.getByRole('button', { name: msg(LOCALE, 'cookies.rejectOptional'), exact: true });
  if (await reject.isVisible().catch(() => false)) await reject.click();
  await expect(page.getByRole('heading', { level: 2, name: t('step1Title') })).toBeVisible();

  // Krok 1 bez tytułu: błąd przy polu, kreator stoi, w bazie nie powstaje oferta.
  await page.getByRole('combobox', { name: t('categoryLabel') }).click();
  await page.getByRole('option', { name: msg(LOCALE, 'categories.logistics'), exact: true }).click();
  await page.getByLabel(t('occupationLabel'), { exact: true }).fill('Orderpicker');
  await next().click();
  const title = page.getByLabel(t('titleLabel'), { exact: true });
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  await expect(page.getByRole('heading', { level: 2, name: t('step1Title') })).toBeVisible();
  expect(await companyJobs()).toEqual([]);

  // Krok 1 poprawny → szkic z technicznym slugiem.
  await title.fill(TITLE);
  await nextStep(2);
  const jobs = await companyJobs();
  expect(jobs).toEqual([expect.objectContaining({ status: 'draft', slug: expect.stringMatching(/^draft-/) })]);
  jobId = jobs[0]!.id;
  expect(await draft()).toMatchObject({ title: TITLE, category: 'logistics', occupation: 'Orderpicker', default_locale: LOCALE });

  // Krok 2: umowa i godziny.
  await chooseOption(page, page.getByRole('combobox', { name: t('contractTypeLabel') }), msg(LOCALE, 'contractTypes.permanent'));
  await page.getByLabel(t('workingHoursLabel'), { exact: true }).fill('38 uur per week');
  await nextStep(3);
  expect(await draft()).toMatchObject({ contract_type: 'permanent', working_hours: '38 uur per week' });

  // Krok 3: lokalizacja.
  await page.getByLabel(t('cityLabel'), { exact: true }).fill('Antwerpen');
  await page.getByLabel(t('regionLabel'), { exact: true }).fill('Vlaanderen');
  await nextStep(4);
  expect(await draft()).toMatchObject({ city: 'Antwerpen', region: 'Vlaanderen', remote: false });

  // Krok 4: wynagrodzenie miesięczne.
  await page.getByLabel(t('salaryMinLabel'), { exact: true }).fill('2600');
  await page.getByLabel(t('salaryMaxLabel'), { exact: true }).fill('3100');
  await chooseOption(page, page.getByRole('combobox', { name: t('salaryPeriodLabel') }), t('periodMonth'));
  await nextStep(5);
  expect(await draft()).toMatchObject({ salary_min: 2600, salary_max: 3100, salary_period: 'month', currency: 'EUR' });

  // Krok 5: opis i obowiązki → tłumaczenie w języku oferty.
  await page.getByLabel(t('descriptionLabel'), { exact: true })
    .fill('Orders verzamelen in ons centrale magazijn in de haven van Antwerpen, in een vast team.');
  await addChip(t('responsibilitiesLabel'), 'Orders verzamelen met scanner');
  await nextStep(6);
  expect(await translation()).toMatchObject({
    title: TITLE,
    description: expect.stringContaining('centrale magazijn'),
    responsibilities: ['Orders verzamelen met scanner'],
  });

  // Krok 6: wymagania i umiejętności obowiązkowe, doświadczenie.
  await addChip(t('requirementsMandatoryLabel'), 'Nauwkeurig werken');
  await addChip(t('mandatorySkillsLabel'), 'Heftruck');
  await page.getByLabel(t('minExperienceLabel'), { exact: true }).fill('1');
  await nextStep(7);
  expect(await db(`SELECT kind::text, content FROM public.job_requirements WHERE job_id = $1`, [jobId]))
    .toEqual([{ kind: 'mandatory', content: 'Nauwkeurig werken' }]);
  expect(await db(`SELECT skill_label, is_mandatory FROM public.job_skills WHERE job_id = $1`, [jobId]))
    .toEqual([{ skill_label: 'Heftruck', is_mandatory: true }]);
  expect(await draft()).toMatchObject({ min_experience_years: 1 });

  // Krok 7: wymaganie i umiejętność dodatkowa, język z poziomem, certyfikat, prawo jazdy.
  await addChip(t('requirementsOptionalLabel'), 'Ervaring met WMS');
  await addChip(t('skillsLabel'), 'Reachtruck');
  await page.getByLabel(t('languagesLabel'), { exact: true }).fill('Nederlands');
  await chooseOption(page, page.getByRole('combobox', { name: t('levelBasic'), exact: true }), t('levelFluent'));
  await page.getByRole('button', { name: t('addLanguage'), exact: true }).click();
  await addChip(t('certificatesLabel'), 'VCA Basis');
  await page.getByRole('checkbox', { name: t('requiresDrivingLicense'), exact: true }).check();
  await nextStep(8);
  expect(await db(`SELECT kind::text, content FROM public.job_requirements WHERE job_id = $1 ORDER BY kind, content`, [jobId]))
    .toEqual([{ kind: 'mandatory', content: 'Nauwkeurig werken' }, { kind: 'optional', content: 'Ervaring met WMS' }]);
  expect(await db(`SELECT skill_label, is_mandatory FROM public.job_skills WHERE job_id = $1 ORDER BY skill_label`, [jobId]))
    .toEqual([{ skill_label: 'Heftruck', is_mandatory: true }, { skill_label: 'Reachtruck', is_mandatory: false }]);
  expect(await db(`SELECT language_label, level::text FROM public.job_languages WHERE job_id = $1`, [jobId]))
    .toEqual([{ language_label: 'Nederlands', level: 'fluent' }]);
  expect(await db(`SELECT certificate_label FROM public.job_certificates WHERE job_id = $1`, [jobId]))
    .toEqual([{ certificate_label: 'VCA Basis' }]);
  expect(await draft()).toMatchObject({ requires_driving_license: true });

  // Krok 8: warunki i benefity.
  await addChip(t('conditionsLabel'), 'Vast contract na proefperiode');
  await addChip(t('benefitsLabel'), 'Maaltijdcheques');
  await page.getByRole('checkbox', { name: t('transport'), exact: true }).check();
  await nextStep(9);
  expect(await translation()).toMatchObject({
    conditions: ['Vast contract na proefperiode'],
    benefits: ['Maaltijdcheques'],
  });
  expect(await draft()).toMatchObject({ transport: true, accommodation: false });

  // Krok 9: opis firmy i kontakt — zapis szkicu przy próbie publikacji (niżej).
  await page.getByLabel(t('companyDescriptionLabel'), { exact: true }).fill('Familiebedrijf in havenlogistiek sinds 1998.');
  await page.getByLabel(t('contactEmailLabel'), { exact: true }).fill(`jobs-${run}@e2e.invalid`);
  expect((await draft()).status).toBe('draft');
});

test('publikacja: odmowa przy firmie niezweryfikowanej, po weryfikacji — oferta aktywna i publiczna', async ({ browser }) => {
  test.setTimeout(240_000);
  const publish = page.getByRole('button', { name: t('publish'), exact: true });
  await page.getByRole('checkbox', { name: t('agreePublish'), exact: true }).check();

  // Firma niezweryfikowana: komunikat, kreator zostaje, oferta nadal szkicem (krok 9 zapisany).
  await publish.click();
  await expect(page.getByText(t('notVerifiedNote'), { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${LOCALE}/employer/oferty/nowa`));
  expect(await draft()).toMatchObject({ status: 'draft', published_at: null, contact_email: `jobs-${run}@e2e.invalid` });
  expect(await translation()).toMatchObject({ company_description: 'Familiebedrijf in havenlogistiek sinds 1998.' });
  expect(await db(`SELECT count(*)::int AS n FROM public.email_deliveries WHERE template = 'jobPublished' AND entity_id = $1`, [jobId]))
    .toEqual([{ n: 0 }]);

  // Administrator weryfikuje firmę; ta sama sesja kreatora publikuje.
  await admin.request((tx) => rpc(tx, 'admin_set_company_status', { p_company_id: companyId, p_status: 'verified' }));
  await publish.click();
  await page.waitForURL(new RegExp(`/${LOCALE}/employer/?$`));
  const published = await draft();
  expect(published).toMatchObject({ status: 'active' });
  expect(published.published_at).not.toBeNull();
  expect(String(published.slug)).not.toMatch(/^draft-/);
  // Potwierdzenie publikacji w języku publikującego (Invariant #1).
  expect(await db(`SELECT locale FROM public.email_deliveries WHERE template = 'jobPublished' AND entity_id = $1`, [jobId]))
    .toEqual([{ locale: LOCALE }]);

  // Gość widzi ofertę pod publicznym adresem (strona czyta bazę przez login aplikacji).
  const guest = await browser.newContext();
  try {
    const view = await guest.newPage();
    await view.goto(`/${LOCALE}/oferty-pracy/${String(published.slug)}`);
    await expect(view.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  } finally {
    await guest.close();
  }
});
