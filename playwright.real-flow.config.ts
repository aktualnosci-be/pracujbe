import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E przepływu kandydat ↔ pracodawca na PRAWDZIWYM PostgreSQL 16 (#351, #66).
 *
 * Uruchamiaj wyłącznie przez `npm run test:e2e:real` (scripts/test-e2e-real.mjs): skrypt tworzy
 * izolowaną bazę z migracjami produkcyjnymi i ograniczone loginy, a tutaj dostajemy tylko ich
 * adresy (E2E_REAL_*). Osobny katalog testów i port — nie koliduje z playwright.config.ts
 * (dane demo, port 3000) ani z konfiguracją fixture (4319/4320).
 */
const PORT = 4331;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const appUrl = process.env.E2E_REAL_APP_URL;
if (!appUrl || !process.env.E2E_REAL_AUTH_URL || !process.env.E2E_REAL_ADMIN_URL) {
  throw new Error('Brak E2E_REAL_*: uruchom przez `npm run test:e2e:real`.');
}
const requireShim = resolve(__dirname, 'tests/e2e/fixtures/require-globals.cjs').replaceAll('\\', '/');

export default defineConfig({
  testDir: './tests/e2e-real',
  // Jeden scenariusz na wspólnej bazie: kroki zależą od siebie, więc bez równoległości i ponowień.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // next dev kompiluje trasę przy pierwszym żądaniu.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['line'], ['github']] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
    },
  }],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      // Strony publiczne czytają oferty z bazy przez ograniczony login aplikacji (nie demo).
      DATABASE_APP_URL: appUrl,
      // Konta i sesje (#24): Better Auth na ograniczonym loginie auth, jak w produkcji.
      // Origin kanoniczny = ten sam co w stosie testu (support/stack.ts): akcje wołają
      // `auth.api` bez obiektu Request, więc origin/CSRF SDK nie dotyczy formularzy aplikacji.
      DATABASE_AUTH_URL: process.env.E2E_REAL_AUTH_URL,
      BETTER_AUTH_URL: 'https://auth.e2e-real.invalid',
      BETTER_AUTH_SECRET: 'e2e-real-flow-secret-not-for-production-0123456789abcdef',
      // Migrator nie trafia do procesu aplikacji.
      E2E_REAL_ADMIN_URL: '',
      E2E_REAL_AUTH_URL: '',
      NODE_OPTIONS: `--require="${requireShim}"`,
    },
  },
});
