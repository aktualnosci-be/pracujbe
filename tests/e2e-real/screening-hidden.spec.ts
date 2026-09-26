import { expect, test, type BrowserContext } from '@playwright/test';
import { createStack, rows, rpc, rpcRows, type Actor, type Stack } from './support/stack';
import { chooseOption, contextWithSession, msg, richLabel } from './support/ui';

/**
 * #497 (0201, decyzja właściciela 26.09.2026): pytanie screeningowe odrzucone PO publikacji
 * oferty jest ukrywane od razu — na PostgreSQL 16 z migracjami produkcyjnymi, w przeglądarce.
 *
 * Stan startowy jak po 0103 dla oferty opublikowanej wcześniej: oferta aktywna, ryzykowne
 * pytanie czeka w kolejce przeglądu (operator ustawia go w bazie — produkt nie ma ścieżki UI
 * do publikacji z nieprzejrzanym pytaniem). Decyzję podejmuje admin RPC pod własną sesją.
 * Po odrzuceniu: oferta dalej aktywna, formularz aplikowania nie pokazuje pytania, zgłoszenie
 * przechodzi bez odpowiedzi na nie (było wymagane), firma nie widzi odpowiedzi sprzed decyzji,
 * a recruiter+ dostaje powiadomienie z prośbą o poprawkę.
 *
 * Kontrola ujemna: E2E_REAL_MUTATION=screening-hidden-off (pytanie wraca do formularza) = czerwony.
 */

const run = Math.random().toString(36).slice(2, 8);
const JOB_SLUG = `kierowca-sh497-${run}`;
const JOB_TITLE = `Kierowca C+E ${run}`;
const VISIBLE = 'Czy masz prawo jazdy C+E?';
const HIDDEN = 'Czy jesteś w ciąży?';

let stack: Stack;
let admin: Actor;
let employer: Actor;
let candidateContext: BrowserContext;
let companyId: string;
let jobId: string;
let visibleId: string;
let hiddenId: string;
let earlierApplication: string;

test.describe.configure({ mode: 'serial' });

const db = async <T>(sql: string, params: unknown[] = []) => rows<T>(await stack.admin.query(sql, params));

test.beforeAll(async () => {
  stack = await createStack();
  admin = await stack.signUpCandidate(`sh-admin-${run}@e2e.invalid`, 'en', ['Ada', 'Admin']);
  await stack.admin.query(
    "UPDATE public.profiles SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = $1)", [admin.email]);
  employer = await stack.signUpEmployer(`sh-employer-${run}@e2e.invalid`, 'nl', ['Jan', 'Peeters'], `Haven SH ${run}`);
  const [company] = await employer.request((tx) => rpcRows<{ company_id: string }>(
    tx, 'create_first_company', { p_name: `Haven SH ${run}`, p_slug: `haven-sh-${run}` }));
  companyId = company!.company_id;
  await admin.request((tx) => rpc(tx, 'admin_set_company_status', { p_company_id: companyId, p_status: 'verified' }));

  const [job] = await db<{ id: string }>(
    `INSERT INTO public.jobs (company_id, slug, default_locale, title, status, category, contract_type, city, region)
     VALUES ($1, $2, 'pl', $3, 'draft', 'transport', 'permanent', 'Gent', 'Vlaanderen') RETURNING id`,
    [companyId, JOB_SLUG, JOB_TITLE]);
  jobId = job!.id;
  await db(`INSERT INTO public.job_translations (job_id, locale, title, description, responsibilities)
            VALUES ($1, 'pl', $2, 'Transport międzynarodowy z Gandawy.', array['Dostawy'])`, [jobId, JOB_TITLE]);
  await db(`INSERT INTO public.job_requirements (job_id, locale, kind, position, content)
            VALUES ($1, 'pl', 'mandatory', 0, 'Prawo jazdy C+E')`, [jobId]);
  await db(`INSERT INTO public.job_screening_questions (job_id, position, type, required, prompt) VALUES
              ($1, 0, 'yes_no', true, jsonb_build_object('pl', $2::text)),
              ($1, 1, 'yes_no', true, jsonb_build_object('pl', $3::text))`, [jobId, VISIBLE, HIDDEN]);
  const questions = await db<{ id: string }>(
    'SELECT id FROM public.job_screening_questions WHERE job_id = $1 ORDER BY position', [jobId]);
  [visibleId, hiddenId] = questions.map((q) => q.id) as [string, string];
  await db('ALTER TABLE public.jobs DISABLE TRIGGER trg_enforce_screening_review');
  await db(`UPDATE public.jobs SET status = 'active', published_at = now() WHERE id = $1`, [jobId]);
  await db('ALTER TABLE public.jobs ENABLE TRIGGER trg_enforce_screening_review');

  // Zgłoszenie sprzed decyzji: kandydat odpowiedział na oba pytania.
  const earlier = await stack.signUpCandidate(`sh-earlier-${run}@e2e.invalid`, 'pl', ['Ewa', 'Nowak']);
  earlierApplication = await earlier.request((tx) => rpc<string>(tx, 'apply_to_job', {
    p_job_id: jobId, p_idempotency_key: `sh-earlier-${run}`,
    p_answers: JSON.stringify({ [visibleId]: true, [hiddenId]: false }),
  }));
});

test.afterAll(async () => {
  await candidateContext?.close();
  await stack?.close();
});

test('admin odrzuca pytanie aktywnej oferty: oferta aktywna, firma bez odpowiedzi, prośba o poprawkę', async () => {
  const [review] = await db<{ id: string }>(
    `SELECT id FROM public.screening_question_reviews WHERE job_id = $1 AND status = 'pending'`, [jobId]);
  await admin.request((tx) => rpc(tx, 'admin_decide_screening_review', {
    p_review_id: review!.id, p_decision: 'rejected', p_reason: 'Pytanie o ciążę — usuń je.',
  }));

  expect(await db('SELECT status::text FROM public.jobs WHERE id = $1', [jobId])).toEqual([{ status: 'active' }]);
  const seen = await employer.request(async (tx) => rows<{ question_id: string }>(await tx.query(
    'SELECT question_id::text FROM public.application_screening_answers WHERE application_id = $1', [earlierApplication])));
  expect(seen).toEqual([{ question_id: visibleId }]);
  expect(await db(
    `SELECT n.data->>'status' AS status FROM public.notifications n JOIN auth.users u ON u.id = n.profile_id
      WHERE u.email = $1 AND n.entity_id = $2`, [employer.email, jobId])).toEqual([{ status: 'hidden' }]);
});

test('ApplyModal bez ukrytego pytania; zgłoszenie przechodzi bez odpowiedzi na nie', async ({ browser, baseURL }) => {
  const candidate = await stack.signUpCandidate(`sh-candidate-${run}@e2e.invalid`, 'pl', ['Olga', 'Kowalska']);
  candidateContext = await contextWithSession(browser, baseURL!, candidate.cookie);
  const page = await candidateContext.newPage();
  const t = (key: string) => msg('pl', `apply.${key}`);

  await page.goto(`/pl/oferty-pracy/${JOB_SLUG}`);
  await page.getByRole('button', { name: msg('pl', 'jobs.applyNow') }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radiogroup', { name: VISIBLE })).toBeVisible();
  await expect(dialog.getByText(HIDDEN)).toHaveCount(0);

  await chooseOption(page, dialog.getByRole('combobox', { name: t('dialCode') }), 'BE +32');
  await dialog.locator('#apply-phone').fill('470123456');
  await dialog.getByRole('radiogroup', { name: VISIBLE }).getByRole('radio', { name: t('screeningYes') }).check();
  await dialog.getByRole('checkbox', { name: richLabel(t('privacyNoticeAck')) }).check();
  await dialog.getByRole('button', { name: t('submit'), exact: true }).click();
  await expect(page.getByText(t('success'), { exact: true })).toBeVisible();

  const answers = await db<{ question_id: string }>(
    `SELECT s.question_id::text FROM public.application_screening_answers s
       JOIN public.applications a ON a.id = s.application_id
       JOIN auth.users u ON u.id = a.candidate_id
      WHERE u.email = $1`, [candidate.email]);
  expect(answers).toEqual([{ question_id: visibleId }]);
});
