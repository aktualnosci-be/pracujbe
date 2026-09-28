import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createStack, rows, type Stack } from './support/stack';
import { confirmThroughLink, msg, registerThroughForm, richLabel } from './support/ui';

/**
 * Zapisane wyszukiwania i alerty w TRYBIE OGŁOSZENIOWYM (#1148, epik #1128) — decyzja produktowa:
 * portal ogłoszeniowy. Funkcja zostaje, bo wynika wyłącznie z filtrów użytkownika; konto
 * kandydata BEZ onboardingu (brak wiersza `candidate_profiles`) zapisuje wyszukiwanie na
 * `/oferty-pracy`, zmienia nazwę i alert w `/candidate/wyszukiwania`, dostaje digest `jobMatch`
 * w swoim języku i wyłącza alert ścieżką linku z e-maila (`saved_search_alert_unsubscribe`,
 * service_role — to samo RPC co `/wypisz-alert` i one-click; strona linku jest w demo-specu
 * `tests/e2e/saved-search.spec.ts`).
 *
 * Uruchomienie (tryb ogłoszeniowy w env serwera ORAZ w bazie):
 *   E2E_PORTAL_LEGAL_MODE= npm run test:e2e:real -- saved-search-classifieds
 * W domyślnym przebiegu real-flow (RECRUITMENT) spec jest pomijany.
 *
 * Kontrola ujemna: E2E_REAL_MUTATION=saved-search-requires-onboarding (zapis wymaga ukończonego
 * profilu) → czerwony pierwszy krok.
 */

const CLASSIFIEDS = (process.env.PORTAL_LEGAL_MODE ?? '').trim().toUpperCase() !== 'RECRUITMENT';
const run = Math.random().toString(36).slice(2, 8);
const KEYWORD = `Magazijnier ${run}`;
const EMAIL = `ss-classifieds-nl-${run}@e2e.invalid`;
const NEW_NAME = `Magazijn nacht ${run}`;

let stack: Stack;
let context: BrowserContext;
let page: Page;
let profileId: string;
let searchId: string;

test.describe.configure({ mode: 'serial' });
test.skip(!CLASSIFIEDS, 'Tryb ogłoszeniowy: uruchom z E2E_PORTAL_LEGAL_MODE= (pusta wartość).');

const db = async <T>(sql: string, params: unknown[] = []) => rows<T>(await stack.admin.query(sql, params));

/** Jedno połączenie: `SET ROLE service_role` i wywołanie w tej samej sesji. */
async function asService<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await stack.admin.connect();
  try {
    await client.query('SET ROLE service_role');
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.query('RESET ROLE').catch(() => undefined);
    client.release();
  }
}

test.beforeAll(async ({ browser }) => {
  stack = await createStack();
  // Harness włącza RECRUITMENT w bazie (przepływy rekrutacyjne) — ten spec wraca do trybu
  // ogłoszeniowego jedyną drogą zmiany (RPC service_role z audytem).
  await asService(`SELECT public.admin_set_portal_legal_mode('CLASSIFIEDS_ONLY', 'e2e-real #1148', 'RECRUITMENT')`);
  const [mode] = await db<{ enabled: boolean }>('SELECT public.recruitment_enabled() AS enabled');
  expect(mode?.enabled).toBe(false);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await stack?.close();
});

test('konto bez onboardingu zapisuje wyszukiwanie z listy ofert', async () => {
  await registerThroughForm(page, { locale: 'nl', email: EMAIL, name: ['Noor', 'Classifieds'] });
  await confirmThroughLink(page, stack.admin, EMAIL, 'nl');
  await page.waitForURL(/\/nl\/candidate/);
  const [profile] = await db<{ id: string }>('SELECT id FROM public.profiles WHERE email = $1', [EMAIL]);
  profileId = profile!.id;
  // Onboarding nietknięty: brak profilu kandydata (a więc i ukończonego profilu).
  expect(await db('SELECT 1 FROM public.candidate_profiles WHERE profile_id = $1', [profileId])).toHaveLength(0);

  await page.goto(`/nl/oferty-pracy?${new URLSearchParams({ keyword: KEYWORD, category: 'warehouse' })}`);
  await page.getByRole('button', { name: msg('nl', 'savedSearches.save'), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: msg('nl', 'savedSearches.saved') })).toBeVisible();

  const [saved] = await db<{ id: string; filters: Record<string, unknown>; alerts_enabled: boolean }>(
    'SELECT id, filters, alerts_enabled FROM public.saved_searches WHERE profile_id = $1', [profileId]);
  expect(saved?.filters).toMatchObject({ keyword: KEYWORD.toLowerCase(), categories: ['warehouse'] });
  expect(saved?.alerts_enabled).toBe(true);
  searchId = saved!.id;
  expect(await db('SELECT 1 FROM public.candidate_profiles WHERE profile_id = $1', [profileId])).toHaveLength(0);
});

test('zmiana nazwy i alertu w panelu kandydata', async () => {
  await page.goto('/nl/candidate/wyszukiwania');
  // Nazwa przycisku = „Naam wijzigen” + nazwa wyszukiwania dla czytnika ekranu.
  await page.getByRole('button', { name: richLabel(msg('nl', 'savedSearches.rename')) }).click();
  await page.getByLabel(msg('nl', 'savedSearches.renameLabel'), { exact: true }).fill(NEW_NAME);
  await page.getByRole('button', { name: msg('nl', 'savedSearches.renameSave'), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: msg('nl', 'savedSearches.renamed') })).toBeVisible();

  const alerts = page.getByRole('checkbox', { name: msg('nl', 'savedSearches.alerts'), exact: true });
  await expect(alerts).toBeChecked();
  await alerts.click();
  await expect(page.getByRole('status').filter({ hasText: msg('nl', 'savedSearches.updated') })).toBeVisible();
  await expect.poll(async () => (await db<{ alerts_enabled: boolean; name: string }>(
    'SELECT alerts_enabled, name FROM public.saved_searches WHERE id = $1', [searchId]))[0])
    .toEqual({ alerts_enabled: false, name: NEW_NAME });
  // Stan kontrolki pochodzi z serwera (odświeżenie po zapisie) — czekamy na nowy stan.
  await expect(alerts).not.toBeChecked();
  await alerts.click();
  await expect(alerts).toBeChecked();
  await expect.poll(async () => (await db<{ alerts_enabled: boolean }>(
    'SELECT alerts_enabled FROM public.saved_searches WHERE id = $1', [searchId]))[0]?.alerts_enabled).toBe(true);
});

test('worker w trybie ogłoszeniowym: digest jobMatch w języku odbiorcy, potem wyłączenie z linku', async () => {
  const [company] = await db<{ id: string }>(
    `INSERT INTO public.companies(name, status) VALUES ($1, 'verified') RETURNING id`, [`Haven ${run}`]);
  const [job] = await db<{ id: string }>(
    `INSERT INTO public.jobs(company_id, slug, title, category, contract_type, city, region, status, default_locale, published_at)
     VALUES ($1, $2, $3, 'warehouse', 'permanent', 'Gent', 'Flandria', 'active', 'nl', now()) RETURNING id`,
    [company!.id, `magazijnier-${run}`, `${KEYWORD} nacht`]);
  await db(`UPDATE public.saved_searches SET next_run_at = now() - interval '1 minute',
              last_checked_at = now() - interval '1 day', alerts_since = now() - interval '2 days' WHERE id = $1`, [searchId]);

  await asService('SELECT public.process_saved_search_alerts(100)');
  expect(await db('SELECT job_id FROM public.saved_search_alerts WHERE saved_search_id = $1', [searchId]))
    .toEqual([{ job_id: job!.id }]);
  expect(await db<{ locale: string }>(
    `SELECT locale FROM public.email_deliveries WHERE profile_id = $1 AND template = 'jobMatch'`, [profileId]))
    .toEqual([{ locale: 'nl' }]);

  await asService('SELECT public.saved_search_alert_unsubscribe($1::uuid, $2::uuid)', [profileId, searchId]);
  await page.goto('/nl/candidate/wyszukiwania');
  await expect(page.getByRole('checkbox', { name: msg('nl', 'savedSearches.alerts'), exact: true })).not.toBeChecked();
});
