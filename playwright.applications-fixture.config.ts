import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { e2ePort } from './scripts/lib/e2e-server.mjs';

/**
 * Osobny serwer dev i dane fikcyjne: nigdy nie dotyka produkcji ani portu konfiguracji demo.
 * Port: 4319 (full) / 4320 (error), a z E2E_PORT=N — N+1 / N+2 (scripts/lib/e2e-server.mjs).
 */
const mode = process.env.TEST_APPLICATIONS_FIXTURE === 'error' ? 'error' : 'full';
const port = e2ePort(mode === 'error' ? 'fixtureError' : 'fixtureFull');
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const requireShim = resolve(__dirname, 'tests/e2e/fixtures/require-globals.cjs').replaceAll('\\', '/');

const ERROR_SPECS = ['**/candidate-applications-error.spec.ts', '**/candidate-dashboard-read-errors.spec.ts', '**/public-read-failures.spec.ts'];
const FULL_SPECS = [
  '**/candidate-applications-pagination.spec.ts',
  '**/candidate-proposals-pagination.spec.ts',
  // Zapisane oferty bez strony publicznej: stan, brak linku, „Usuń z zapisanych” (0162).
  '**/candidate-saved-closed.spec.ts',
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
];

/**
 * Podział trybu `full` na 2 joby CI (`TEST_APPLICATIONS_FIXTURE_PART=1/2` | `2/2`; ci.yml,
 * `e2e-fixtures`). Jawna lista części 2 zamiast `--shard`: Playwright dzieli pliki po liczbie
 * testów w kolejności alfabetycznej, więc oba speci lejka (~5,4 min z ~8,9) trafiały do
 * jednego shardu. Tu część 2 = najdłuższy spec lejka + profil firmy + a11y formularza
 * (~4,5 min), część 1 = cała reszta (~4,4 min; nowy spec trafia tu domyślnie). Czasy
 * z przebiegu CI 27.09.2026. Bez zmiennej (lokalnie) — cały tryb naraz.
 */
const FULL_PART_2 = [
  '**/job-funnel-no-storage.spec.ts',
  '**/company-profile.spec.ts',
  '**/apply-modal-a11y.spec.ts',
];
for (const spec of FULL_PART_2) {
  if (!FULL_SPECS.includes(spec)) throw new Error(`FULL_PART_2: ${spec} nie należy do trybu full`);
}

const part = process.env.TEST_APPLICATIONS_FIXTURE_PART ?? '';
if (part && !(mode === 'full' ? ['1/2', '2/2'] : ['1/1']).includes(part)) {
  throw new Error(`TEST_APPLICATIONS_FIXTURE_PART=${part}: dozwolone 1/2, 2/2 (full) albo 1/1 (error)`);
}
function specsFor(): string[] {
  if (mode === 'error') return ERROR_SPECS;
  if (part === '2/2') return FULL_PART_2;
  if (part === '1/2') return FULL_SPECS.filter((spec) => !FULL_PART_2.includes(spec));
  return FULL_SPECS;
}

/** Raport cząstkowy (blob) w CI — łączy go job zbiorczy „E2E (Playwright)” (jak shardy demo). */
const BLOB_NAME = (process.env.E2E_BLOB_NAME ?? '').replace(/[^a-z0-9-]/gi, '');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: specsFor(),
  workers: 1,
  // next dev kompiluje trasę przy pierwszym żądaniu; na zimnym starcie trwa to ponad 30 s.
  timeout: 120_000,
  retries: 0,
  reporter: BLOB_NAME
    ? [['list'], ['github'], ['blob', { outputDir: 'blob-report', fileName: `report-${BLOB_NAME}.zip` }]]
    : 'list',
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
      // #1136: przepływy rekrutacyjne — tryb jawnie włączony (domyślnie = tryb ogłoszeniowy).
      PORTAL_LEGAL_MODE: process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require="${requireShim}"`].filter(Boolean).join(' '),
    },
  },
});
