import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_CF_ANALYTICS_TOKEN } from './fixtures/trackers';

/**
 * Testy dymne (smoke) — działają na danych demonstracyjnych (bez Supabase).
 *
 * Zakres:
 *  1. Strona główna /pl: obecność nagłówka (heroTitle) i wyszukiwarki.
 *  2. Lista ofert /pl/oferty-pracy: wyniki (co najmniej jedna oferta).
 *  3. Baner cookies (Invariant #7): przed zgodą i po „Tylko niezbędne" zero żądań do beaconu
 *     Cloudflare Web Analytics; po „Akceptuj wszystkie" beacon się ładuje (dowód, że test go widzi).
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

  // Metryczka pochodzi z tego samego artefaktu co strona. Dozwolone są wyłącznie dwa
  // tryby z docs/DEPLOYMENT.md (#103): automatyczny 0.YYYYMMDD.M[+SHA] albo 1.0.0+SHA.
  const buildTime = page.locator('footer time[datetime]').last();
  const release = buildTime.locator('..');
  await expect(release).toHaveText(
    /^v(?:0\.\d{8}\.\d+(?:\+[0-9a-f]{7,8})?|1\.0\.0\+[0-9a-f]{7,8}) · \S/,
  );
  // W CI build dostaje GITHUB_SHA — stopka musi wskazywać dokładnie ten commit.
  const sha = process.env.GITHUB_SHA?.trim().toLowerCase();
  if (sha && /^[0-9a-f]{7,40}$/.test(sha)) {
    await expect(release).toContainText(`+${sha.slice(0, 8)} `);
  }
  await expect(buildTime).toHaveAttribute(
    'datetime',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});

test('lista ofert /pl/oferty-pracy renderuje wyniki', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');

  // Tytuł strony listy.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pl.jobs.pageTitle);

  // #376: co najmniej jedna KARTA wyniku (artykuł na liście w `main`) z linkiem do szczegółów.
  // Asercja z ponawianiem, a nie jednorazowy `count()`; breadcrumb/stopka jej nie spełnią.
  const results = page.getByRole('main').getByRole('listitem').getByRole('article');
  await expect(results).not.toHaveCount(0);
  await expect(results.first().getByRole('heading', { level: 3 }).getByRole('link')).toHaveAttribute(
    'href',
    /^\/pl\/oferty-pracy\/[^/?#]+$/,
  );
});

/**
 * Strażnik Invariantu #7 (zero trackingu przed zgodą), issue #234/#570.
 *
 * Build E2E ma testowy token Cloudflare Web Analytics (playwright.config.ts), więc komponent
 * `Analytics` realnie wyrenderowałby beacon. Wszystkie żądania do cloudflareinsights.com są
 * przechwytywane i blokowane (`page.route`) — liczymy je, ale nic nie wychodzi do dostawcy.
 */
const TRACKER_HOSTS = /^https:\/\/([a-z0-9.-]*\.)?cloudflareinsights\.com\//;
const CF_BEACON_SCRIPT = 'script#cf-web-analytics';

// Okno obserwacji: skrypty `afterInteractive` wstrzykiwane są asynchronicznie po hydratacji,
// więc samo `count()` tuż po kliknięciu mogłoby je przegapić.
const QUIET_WINDOW_MS = 3_000;

async function trackTrackerRequests(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.route(TRACKER_HOSTS, async (route) => {
    seen.push(route.request().url());
    // Pusty skrypt zamiast realnej odpowiedzi — zero ruchu do dostawcy.
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  return seen;
}

async function expectNoTracking(page: Page, seen: string[]) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(seen, 'żądania do Cloudflare Web Analytics przed zgodą').toEqual([]);
  await expect(page.locator(CF_BEACON_SCRIPT)).toHaveCount(0);
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

test('baner cookies: po „Akceptuj wszystkie" beacon Cloudflare Web Analytics się ładuje (test go widzi)', async ({
  page,
}) => {
  const seen = await trackTrackerRequests(page);
  await page.goto('/pl');

  const banner = page.getByRole('region', { name: pl.cookies.bannerTitle });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: pl.cookies.acceptAll }).click();
  await expect(banner).toBeHidden();

  // Dowód, że build ma testowy token, a przechwytywanie działa — inaczej scenariusz ujemny
  // przechodziłby zawsze (issue #234).
  await expect.poll(() => seen.length, { message: 'żądanie do beaconu po zgodzie' }).toBeGreaterThan(0);
  expect(seen.some((url) => url.includes('beacon.min.js'))).toBe(true);
  const script = page.locator(CF_BEACON_SCRIPT);
  await expect(script).toHaveCount(1);
  // Token jest w atrybucie `data-cf-beacon` (JSON), nie w adresie skryptu.
  expect(await script.getAttribute('data-cf-beacon')).toContain(E2E_CF_ANALYTICS_TOKEN);
});
