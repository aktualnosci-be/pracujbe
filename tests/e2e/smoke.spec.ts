import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_GA_MEASUREMENT_ID } from './fixtures/trackers';

/**
 * Testy dymne (smoke) — działają na danych demonstracyjnych (bez Supabase).
 *
 * Zakres:
 *  1. Strona główna /pl: obecność nagłówka (heroTitle) i wyszukiwarki.
 *  2. Lista ofert /pl/oferty-pracy: wyniki (co najmniej jedna oferta).
 *  3. Baner cookies (Invariant #7): przed zgodą i po „Tylko niezbędne" zero żądań GA/Meta;
 *     po „Akceptuj wszystkie" trackery się ładują (dowód, że test je widzi).
 */

type Messages = {
  home: { heroTitle: string; searchButton: string };
  jobs: { pageTitle: string };
  cookies: { bannerTitle: string; rejectOptional: string; acceptAll: string };
};

function loadPlMessages(): Messages {
  const file = resolve(process.cwd(), 'src', 'messages', 'pl.json');
  return JSON.parse(readFileSync(file, 'utf-8')) as Messages;
}

const pl = loadPlMessages();

test('strona główna /pl pokazuje nagłówek i wyszukiwarkę', async ({ page }) => {
  await page.goto('/pl');

  // Nagłówek hero (H1) z tekstem z tłumaczeń.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pl.home.heroTitle);

  // Wyszukiwarka: landmark role="search" + przycisk wyszukiwania.
  const search = page.getByRole('search');
  await expect(search).toBeVisible();
  await expect(
    search.getByRole('button', { name: pl.home.searchButton }),
  ).toBeVisible();

  // Metryczka pochodzi z tego samego artefaktu co strona i pozostaje pre-1.0.
  const buildTime = page.locator('footer time[datetime]').last();
  const release = buildTime.locator('..');
  await expect(release).toContainText(/v0\.\d{8}\.\d+(?:\+[0-9a-f]{7,8})?/);
  await expect(buildTime).toHaveAttribute(
    'datetime',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});

test('lista ofert /pl/oferty-pracy renderuje wyniki', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');

  // Tytuł strony listy.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pl.jobs.pageTitle);

  // Co najmniej jedna oferta (link do szczegółów /oferty-pracy/<slug>).
  const jobLinks = page.locator('a[href*="/oferty-pracy/"]');
  expect(await jobLinks.count()).toBeGreaterThan(0);
});

/**
 * Strażnik Invariantu #7 (zero trackingu przed zgodą), issue #234.
 *
 * Build E2E ma testowe ID GA/Meta (playwright.config.ts), więc komponent `Analytics`
 * realnie wyrenderowałby trackery. Wszystkie żądania do hostów trackerów są przechwytywane
 * i blokowane (`page.route`) — liczymy je, ale nic nie wychodzi do Google/Meta.
 */
const TRACKER_HOSTS = /^https:\/\/(www\.googletagmanager\.com|[a-z0-9.-]*google-analytics\.com|connect\.facebook\.net|www\.facebook\.com)\//;
const GTM_SCRIPT = 'script[src*="googletagmanager.com"]';

// Okno obserwacji: skrypty `afterInteractive` wstrzykiwane są asynchronicznie po hydratacji,
// więc samo `count()` tuż po kliknięciu mogłoby je przegapić.
const QUIET_WINDOW_MS = 3_000;

async function trackTrackerRequests(page: Page): Promise<{ gtm: string[]; meta: string[] }> {
  const seen = { gtm: [] as string[], meta: [] as string[] };
  await page.route(TRACKER_HOSTS, async (route) => {
    const url = route.request().url();
    if (url.includes('googletagmanager.com') || url.includes('google-analytics.com')) seen.gtm.push(url);
    else seen.meta.push(url);
    // Pusty skrypt zamiast realnej odpowiedzi — zero ruchu do dostawców.
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  return seen;
}

async function expectNoTracking(page: Page, seen: { gtm: string[]; meta: string[] }) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(seen.gtm, 'żądania GA przed zgodą').toEqual([]);
  expect(seen.meta, 'żądania Meta Pixel przed zgodą').toEqual([]);
  await expect(page.locator(GTM_SCRIPT)).toHaveCount(0);
  const globals = await page.evaluate(() => {
    const w = window as unknown as { gtag?: unknown; fbq?: unknown };
    return { gtag: typeof w.gtag, fbq: typeof w.fbq };
  });
  expect(globals).toEqual({ gtag: 'undefined', fbq: 'undefined' });
}

test('baner cookies: przed zgodą i po „Tylko niezbędne" analityka się nie ładuje', async ({
  page,
}) => {
  const seen = await trackTrackerRequests(page);
  await page.goto('/pl');

  // Baner pojawia się po stronie klienta (po zamontowaniu).
  const banner = page.getByRole('region', { name: pl.cookies.bannerTitle });
  await expect(banner).toBeVisible();

  // Przed jakąkolwiek zgodą: zero żądań i skryptów trackerów.
  await expectNoTracking(page, seen);

  // Odrzucenie opcjonalnych zgód.
  await banner.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  await expect(banner).toBeHidden();
  await expectNoTracking(page, seen);

  // Kolejna wizyta z zapisaną odmową również nie ładuje trackerów.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoTracking(page, seen);
});

test('baner cookies: po „Akceptuj wszystkie" GA i Meta Pixel się ładują (test widzi trackery)', async ({
  page,
}) => {
  const seen = await trackTrackerRequests(page);
  await page.goto('/pl');

  const banner = page.getByRole('region', { name: pl.cookies.bannerTitle });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: pl.cookies.acceptAll }).click();
  await expect(banner).toBeHidden();

  // Dowód, że build ma testowe ID, a przechwytywanie działa — inaczej scenariusz ujemny
  // przechodziłby zawsze (issue #234).
  await expect.poll(() => seen.gtm.length, { message: 'żądanie GA po zgodzie' }).toBeGreaterThan(0);
  expect(seen.gtm.some((url) => url.includes(E2E_GA_MEASUREMENT_ID))).toBe(true);
  await expect(page.locator(GTM_SCRIPT)).toHaveCount(1);
  await expect.poll(() => seen.meta.length, { message: 'żądanie Meta Pixel po zgodzie' }).toBeGreaterThan(0);
});
