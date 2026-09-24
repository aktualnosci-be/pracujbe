import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_GA_MEASUREMENT_ID, E2E_META_PIXEL_ID } from './tests/e2e/fixtures/trackers';

/**
 * Konfiguracja Playwright (testy E2E).
 *
 * - testDir: ./tests/e2e
 * - webServer: buduje i uruchamia aplikację produkcyjnie (next build && next start)
 *   na porcie 3000. Testy E2E działają na danych demonstracyjnych (bez Supabase),
 *   dzięki czemu przechodzą BEZ zmiennych środowiskowych.
 * - baseURL: http://localhost:3000
 * - projekt: chromium
 * - reporter: html (+ list/github w CI) i raport flaków (#375)
 *
 * W CI serwer jest budowany od zera; lokalnie można podmienić komendę na `npm run dev`.
 *
 * Self-hosted: gdy runner ma preinstalowaną przeglądarkę (np. /opt/pw-browsers/chromium)
 * ustaw PLAYWRIGHT_CHROMIUM_PATH — Playwright użyje jej zamiast pobierać własną
 * (unika błędu „Executable doesn't exist" przy niezgodności wersji builda). Bez tej
 * zmiennej zachowanie jest domyślne.
 */

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/**
 * Testowe identyfikatory trackerów (Invariant #7, issue #234). Bez nich komponent
 * `Analytics` nigdy nie renderuje GA/Meta Pixel i test zgód nie może wykryć regresji.
 * NEXT_PUBLIC_* są wklejane do bundla w czasie `next build`, więc muszą trafić do builda.
 * Żądania do Google/Meta są w testach przechwytywane (`page.route`) — zero realnego ruchu.
 */
const TRACKER_ENV = {
  NEXT_PUBLIC_GA_MEASUREMENT_ID: E2E_GA_MEASUREMENT_ID,
  NEXT_PUBLIC_META_PIXEL_ID: E2E_META_PIXEL_ID,
};

/** Czy gotowy build (.next) ma wklejone testowe ID trackerów. */
function buildHasTrackerIds(): boolean {
  const dir = join(process.cwd(), '.next', 'static', 'chunks');
  if (!existsSync(dir)) return false;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const name of readdirSync(current)) {
      const file = join(current, name);
      if (statSync(file).isDirectory()) pending.push(file);
      else if (name.endsWith('.js') && readFileSync(file, 'utf-8').includes(E2E_GA_MEASUREMENT_ID)) {
        return true;
      }
    }
  }
  return false;
}

// CI buduje w osobnym kroku (PLAYWRIGHT_SKIP_BUILD=1). Jeśli ten build nie ma testowych ID
// trackerów, przebudowujemy go tutaj — inaczej test zgód przechodziłby zawsze (issue #234).
const reuseBuild = process.env.PLAYWRIGHT_SKIP_BUILD === '1' && buildHasTrackerIds();

export default defineConfig({
  testDir: './tests/e2e',
  // Te scenariusze wymagają serwera z danymi fikcyjnymi (playwright.applications-fixture.config.ts);
  // na danych demo zawsze by padły.
  testIgnore: [
    '**/candidate-applications-pagination.spec.ts',
    '**/candidate-applications-error.spec.ts',
    '**/candidate-proposals-pagination.spec.ts',
    '**/candidate-dashboard-read-errors.spec.ts',
    '**/public-read-failures.spec.ts',
    // Formularz aplikowania i JobPosting ofert „realnych” — od #297 tryb demo pokazuje zamiast
    // nich komunikat, więc testujemy je na serwerze fixture.
    '**/apply-modal-a11y.spec.ts',
    '**/apply-network-error.spec.ts',
    '**/apply-phone-validation.spec.ts',
    '**/apply-screening.spec.ts',
    '**/job-posting-fixture.spec.ts',
    '**/offer-message-login.spec.ts',
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Niestabilność ma być widoczna (#375). Jedno ponowienie odróżnia test niestabilny
  // od stale czerwonego i zbiera trace ('on-first-retry'), ale test, który przeszedł
  // dopiero przy ponowieniu, i tak czerwieni przebieg (`failOnFlakyTests`). Listę flaków
  // z błędami nieudanych prób wypisuje tests/e2e/reporters/flaky-report.ts (stdout,
  // podsumowanie joba, plik flaky-tests.json); reporter `github` dodaje adnotacje.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ['line'],
        ['github'],
        ['html', { open: 'never' }],
        // Po reporterze html: plik trafia do playwright-report/, wysyłanego jako artefakt.
        ['./tests/e2e/reporters/flaky-report.ts', { outputFile: 'playwright-report/flaky-tests.json' }],
      ]
    : [['html'], ['./tests/e2e/reporters/flaky-report.ts']],
  // Świeżo zbudowany serwer (next start) hydratuje pierwsze żądania „na zimno" — elementy
  // montowane po stronie klienta (np. baner cookies) mogą pojawić się nieco później niż
  // domyślne 5 s. Dajemy asercjom 10 s, by uniknąć flaky na zimnym starcie/pod obciążeniem.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {}),
      },
    },
  ],
  webServer: {
    // CI buduje w osobnym kroku; limit gotowości mierzy wtedy wyłącznie start serwera.
    command: reuseBuild ? 'npm run start' : 'npm run build && npm run start',
    env: TRACKER_ENV,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: reuseBuild ? 180_000 : 900_000,
  },
});
