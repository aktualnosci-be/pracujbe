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
    ? ['**/candidate-applications-error.spec.ts', '**/candidate-dashboard-read-errors.spec.ts']
    : '**/candidate-applications-pagination.spec.ts',
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
