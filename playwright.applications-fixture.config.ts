import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/** Osobny serwer dev i dane fikcyjne: nigdy nie dotyka produkcji ani współdzielonego portu 3000. */
const mode = process.env.TEST_APPLICATIONS_FIXTURE === 'error' ? 'error' : 'full';
const port = mode === 'error' ? 4320 : 4319;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const requireShim = resolve(__dirname, 'tests/e2e/fixtures/require-globals.cjs').replaceAll('\\', '/');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: mode === 'error'
    ? ['**/candidate-applications-error.spec.ts', '**/candidate-dashboard-read-errors.spec.ts', '**/public-read-failures.spec.ts']
    : [
        '**/candidate-applications-pagination.spec.ts',
        '**/candidate-proposals-pagination.spec.ts',
        // Oferty fikcyjne bez flagi demo (#297): formularz aplikowania i JobPosting.
        '**/apply-modal-a11y.spec.ts',
        '**/apply-network-error.spec.ts',
        '**/apply-phone-validation.spec.ts',
        // Pytania screeningowe oferty fikcyjnej 1003 (#101).
        '**/apply-screening.spec.ts',
        // #98: aplikacja bez konta (gość = cookie fixture, bez bazy).
        '**/guest-apply.spec.ts',
        '**/job-posting-fixture.spec.ts',
        // Profil publiczny firmy: linki, Organization JSON-LD, noindex bez ofert, axe (#591).
        '**/company-profile.spec.ts',
        '**/offer-message-login.spec.ts',
        // Formularz zgłoszenia treści (#41).
        '**/content-report-form.spec.ts',
        // Formularz kontaktu (#61).
        '**/contact-form.spec.ts',
        // Lejek ofert bez cookies/storage przed zgodą (#499).
        '**/job-funnel-no-storage.spec.ts',
        // Lejek wyłączony na urządzeniu osoby 16–17 (#492/#576, PRIV-01).
        '**/job-funnel-minor-marker.spec.ts',
      ],
  workers: 1,
  // next dev kompiluje trasę przy pierwszym żądaniu; na zimnym starcie trwa to ponad 30 s.
  timeout: 120_000,
  retries: 0,
  reporter: 'list',
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
    },
  }],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PLAYWRIGHT_APPLICATIONS_FIXTURE: mode,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require="${requireShim}"`].filter(Boolean).join(' '),
    },
  },
});
