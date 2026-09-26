import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { LOCALES, messages } from './fixtures/messages';

/**
 * #492/#576 (PRIV-01, test sieciowy): na urządzeniu ze znacznikiem `pracujbe.funnel.minor`
 * (konto 16–17 lat — zapisuje go panel kandydata, rejestracja albo formularz gościa) lejek ofert
 * (#99) nie wysyła ŻADNEGO żądania do `/api/job-funnel`, choć zgoda analityczna jest udzielona
 * (znacznik działa jak brak zgody, niezależnie od banera):
 * - wyświetlenie szczegółu, lista ofert, „Aplikuj”, zmiana strony, odświeżenie i zamknięcie karty
 *   (unload — `fetch` z `keepalive` wyszedłby także po zamknięciu); 4 języki;
 * - druga karta tego samego urządzenia (wspólny localStorage);
 * - znacznik zapisany w drugiej karcie, gdy pierwsza jest już otwarta — pierwsza czyta go
 *   w chwili wysyłki, więc jej kolejne zdarzenia też nie wychodzą;
 * - kontrola ujemna: ten sam przebieg bez znacznika (i ze znacznikiem innym niż `1`) wysyła
 *   zdarzenia — obserwator działa, a zero żądań wynika ze znacznika, nie z przebiegu testu;
 *   zdjęcie znacznika (potwierdzenie 18+) przywraca pomiar.
 *
 * Żądania łapie `context.route` (wszystkie karty kontekstu, także żądania `keepalive`, które
 * w Playwright nie emitują `requestfinished`) i odpowiada 204 bez przekazania do serwera.
 * Serwer fixture (`playwright.applications-fixture.config.ts`, tryb full): oferty fikcyjne bez
 * flagi demo, więc wyspa `JobFunnelBeacon` wysyła zdarzenia jak przy ofertach z bazy.
 */

const JOB_SLUG = 'warehouse-worker-antwerp-1001';
const CONSENT_COOKIE = 'pracujbe_consent';
const MINOR_KEY = 'pracujbe.funnel.minor';

/** Zgoda analityczna zapisana wcześniej — jedyną bramką w teście zostaje znacznik. */
async function grantAnalytics(context: BrowserContext, baseURL: string) {
  await context.addCookies([{
    name: CONSENT_COOKIE,
    value: encodeURIComponent(JSON.stringify({
      v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
      categories: { necessary: true, preferences: false, analytics: true },
      ts: '2026-01-01T00:00:00.000Z',
      id: 'job-funnel-minor-e2e',
    })),
    url: baseURL,
  }]);
}

/** Znacznik w localStorage przed pierwszym skryptem strony (jak po wcześniejszej wizycie). */
async function presetMarker(context: BrowserContext, value: string) {
  await context.addInitScript(([key, v]) => {
    try {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, v);
    } catch {
      // about:blank bez storage.
    }
  }, [MINOR_KEY, value] as const);
}

async function watchFunnel(context: BrowserContext): Promise<string[]> {
  const events: string[] = [];
  await context.route('**/api/job-funnel', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { event?: string };
    events.push(body.event ?? '?');
    await route.fulfill({ status: 204 });
  });
  return events;
}

/** Po załadowaniu i hydratacji wyspa lejka miała okazję wysłać zdarzenie (kontrola ujemna). */
async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
}

async function openApply(page: Page, locale: string) {
  await page.getByRole('button', { name: messages(locale).jobs.applyNow }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
}

/**
 * Wspólny przebieg: szczegół → „Aplikuj” → lista → odświeżenie → druga karta → zamknięcie kart
 * zaraz po wejściu na stronę (unload w trakcie hydratacji i po niej).
 */
async function browseAndLeave(context: BrowserContext, page: Page, locale: string) {
  const job = `/${locale}/oferty-pracy/${JOB_SLUG}`;
  const list = `/${locale}/oferty-pracy`;
  await page.goto(job);
  await settle(page);
  await openApply(page, locale);
  await settle(page);
  await page.goto(list);
  await settle(page);
  await page.reload();
  await settle(page);

  const second = await context.newPage();
  await second.goto(job);
  await settle(second);
  await openApply(second, locale);
  await second.close({ runBeforeUnload: true });

  await page.goto(job);
  await openApply(page, locale);
  await page.close({ runBeforeUnload: true });

  // Karta zamknięta tuż po załadowaniu (unload przed pełną hydratacją).
  const quick = await context.newPage();
  await quick.goto(list, { waitUntil: 'commit' });
  await quick.close({ runBeforeUnload: true });
}

/** Czas na dotarcie żądań `keepalive` wysłanych przy zamykaniu kart. */
async function drain(context: BrowserContext) {
  const probe = await context.newPage();
  await probe.waitForTimeout(2000);
  await probe.close();
}

test.beforeEach(async ({ context, baseURL }) => {
  await grantAnalytics(context, baseURL!);
});

for (const locale of LOCALES) {
  test(`(${locale}) znacznik 16–17: zero żądań lejka — strony, „Aplikuj”, druga karta, zamknięcie kart`, async ({ context, page }) => {
    test.setTimeout(240_000);
    await presetMarker(context, '1');
    const events = await watchFunnel(context);
    await browseAndLeave(context, page, locale);
    await drain(context);
    expect(events, 'urządzenie osoby 16–17').toEqual([]);
  });
}

test('znacznik zapisany w drugiej karcie wyłącza lejek w już otwartej pierwszej', async ({ context, page }) => {
  test.setTimeout(240_000);
  const events = await watchFunnel(context);
  const job = `/pl/oferty-pracy/${JOB_SLUG}`;

  // Bez znacznika wyświetlenie wychodzi (obserwator działa).
  await page.goto(job);
  await expect.poll(() => events.length).toBe(1);

  // Druga karta zapisuje znacznik (jak po wyborze 16–17 w formularzu).
  const second = await context.newPage();
  await second.goto('/pl/oferty-pracy');
  await expect.poll(() => events.filter((e) => e === 'search_appearance').length).toBe(1);
  await second.evaluate((key) => window.localStorage.setItem(key, '1'), MINOR_KEY);
  await second.close({ runBeforeUnload: true });

  // Pierwsza karta: „Aplikuj”, odświeżenie, zmiana strony i zamknięcie — nic więcej.
  await openApply(page, 'pl');
  await settle(page);
  await page.reload();
  await settle(page);
  await page.goto('/pl/oferty-pracy');
  await settle(page);
  await page.close({ runBeforeUnload: true });
  await drain(context);
  expect(events.sort()).toEqual(['detail_view', 'search_appearance']);
});

test('kontrola ujemna: bez znacznika ten sam przebieg wysyła zdarzenia lejka', async ({ context, page }) => {
  test.setTimeout(240_000);
  const events = await watchFunnel(context);
  await browseAndLeave(context, page, 'pl');
  await drain(context);
  expect(events).toContain('detail_view');
  expect(events).toContain('apply_started');
  expect(events).toContain('search_appearance');
});

test('kontrola ujemna: znacznik o innej wartości niż „1” nie wyłącza lejka', async ({ context, page }) => {
  await presetMarker(context, '0');
  const events = await watchFunnel(context);
  await page.goto(`/pl/oferty-pracy/${JOB_SLUG}`);
  await expect.poll(() => events).toEqual(['detail_view']);
});

test('zdjęcie znacznika (potwierdzenie 18+) przywraca pomiar', async ({ context, page }) => {
  const events = await watchFunnel(context);
  // Strona bez wyspy lejka zapisuje znacznik (jak panel kandydata 16–17).
  await page.goto('/pl/pomoc');
  await page.evaluate((key) => window.localStorage.setItem(key, '1'), MINOR_KEY);
  await page.goto(`/pl/oferty-pracy/${JOB_SLUG}`);
  await settle(page);
  expect(events).toEqual([]);

  await page.evaluate((key) => window.localStorage.removeItem(key), MINOR_KEY);
  await page.reload();
  await expect.poll(() => events).toEqual(['detail_view']);
});
