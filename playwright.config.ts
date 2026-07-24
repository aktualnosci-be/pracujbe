import { defineConfig, devices } from '@playwright/test';

/**
 * Konfiguracja Playwright (testy E2E).
 *
 * - testDir: ./tests/e2e
 * - webServer: buduje i uruchamia aplikację produkcyjnie (next build && next start)
 *   na porcie 3000. Testy E2E działają na danych demonstracyjnych (bez Supabase),
 *   dzięki czemu przechodzą BEZ zmiennych środowiskowych.
 * - baseURL: http://localhost:3000
 * - projekt: chromium
 * - reporter: html
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

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
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
    command: 'npm run build && npm run start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
