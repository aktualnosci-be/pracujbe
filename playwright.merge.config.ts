/**
 * Łączenie raportów cząstkowych E2E w CI (job „E2E (Playwright)”):
 * `npx playwright merge-reports --config playwright.merge.config.ts blob-report`.
 * Shardy (`--shard=i/N`) i pomiar czasu zapisują blob (playwright.config.ts, E2E_BLOB_NAME);
 * tutaj powstaje jeden raport html i jeden raport flaków (#375) dla całego zestawu.
 */
const config = {
  testDir: './tests/e2e',
  reporter: [
    ['line'],
    ['html', { open: 'never' }],
    ['./tests/e2e/reporters/flaky-report.ts', { outputFile: 'playwright-report/flaky-tests.json' }],
  ],
};

export default config;
