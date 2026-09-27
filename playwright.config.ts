import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_CF_ANALYTICS_TOKEN } from './tests/e2e/fixtures/trackers';
import { E2E_UNSUBSCRIBE_SECRET } from './tests/e2e/fixtures/unsubscribe';
import { e2eBaseUrl, e2ePort, e2eReuseServer } from './scripts/lib/e2e-server.mjs';

/**
 * Konfiguracja Playwright (testy E2E).
 *
 * - testDir: ./tests/e2e
 * - webServer: buduje i uruchamia aplikację produkcyjnie (next build && next start)
 *   na porcie E2E_PORT (domyślnie 3000). Testy E2E działają na danych demonstracyjnych
 *   (bez Supabase), dzięki czemu przechodzą BEZ zmiennych środowiskowych.
 * - baseURL: http://localhost:${E2E_PORT:-3000} (scripts/lib/e2e-server.mjs)
 * - serwer już działający na porcie jest używany tylko przy E2E_REUSE_SERVER=1 (poza CI);
 *   domyślnie zajęty port = błąd startu, nie ciche testowanie cudzego serwera
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

const PORT = e2ePort('demo');
const BASE_URL = e2eBaseUrl('demo');
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;
/** Keep-alive serwera E2E (ms) — dłuższy niż bezczynność gniazd agenta HTTP Playwrighta. */
const SERVER_KEEP_ALIVE_MS = 120_000;

/**
 * Testowy token Cloudflare Web Analytics (Invariant #7, issue #234/#570). Bez niego komponent
 * `Analytics` nigdy nie renderuje beaconu i test zgód nie może wykryć regresji.
 * NEXT_PUBLIC_* są wklejane do bundla w czasie `next build`, więc muszą trafić do builda.
 * Żądania do cloudflareinsights.com są w testach przechwytywane (`page.route`) — zero realnego ruchu.
 */
const TRACKER_ENV = {
  NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN: E2E_CF_ANALYTICS_TOKEN,
};

/**
 * Import ogłoszenia (#465) z atrapą dostawcy AI — czytane w runtime serwera, więc działa także
 * z gotowym buildem z CI. Atrapa nie odpowiada w `APP_MODE=production` i nie łączy się z siecią.
 */
const JOB_IMPORT_ENV = {
  AI_JOB_IMPORT_ENABLED: '1',
  AI_JOB_IMPORT_PROVIDER: 'fixture',
  // Import CV (#487) — osobna flaga, ta sama zasada atrapy (bez sieci, nie w produkcji).
  AI_CV_IMPORT_ENABLED: '1',
  AI_CV_IMPORT_PROVIDER: 'fixture',
};

/** Asystent redagowania oferty (#37) — ta sama zasada: atrapa w runtime, nigdy w produkcji. */
const JOB_ASSIST_ENV = {
  AI_JOB_ASSIST_ENABLED: '1',
  AI_JOB_ASSIST_PROVIDER: 'fixture',
};

/** Czy gotowy build (.next) ma wklejony testowy token Cloudflare Web Analytics. */
function buildHasTrackerIds(): boolean {
  const dir = join(process.cwd(), '.next', 'static', 'chunks');
  if (!existsSync(dir)) return false;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const name of readdirSync(current)) {
      const file = join(current, name);
      if (statSync(file).isDirectory()) pending.push(file);
      else if (name.endsWith('.js') && readFileSync(file, 'utf-8').includes(E2E_CF_ANALYTICS_TOKEN)) {
        return true;
      }
    }
  }
  return false;
}

// CI buduje w osobnym kroku (PLAYWRIGHT_SKIP_BUILD=1). Jeśli ten build nie ma testowych ID
// trackerów, przebudowujemy go tutaj — inaczej test zgód przechodziłby zawsze (issue #234).
const BROWSER = {
  ...devices['Desktop Chrome'],
  ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {}),
};

const reuseBuild = process.env.PLAYWRIGHT_SKIP_BUILD === '1' && buildHasTrackerIds();

/**
 * Te scenariusze wymagają serwera z danymi fikcyjnymi (playwright.applications-fixture.config.ts);
 * na danych demo zawsze by padły.
 */
const FIXTURE_ONLY_SPECS = [
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
  '**/guest-apply.spec.ts',
  '**/job-posting-fixture.spec.ts',
  // Profil firmy (#591) — w demo profili nie ma (404); linki, JSON-LD, noindex i axe na fixture.
  '**/company-profile.spec.ts',
  '**/offer-message-login.spec.ts',
  // Pełny formularz zgłoszenia treści (#41) — oferta fikcyjna bez flagi demo.
  '**/content-report-form.spec.ts',
  '**/job-funnel-no-storage.spec.ts',
  '**/job-funnel-minor-marker.spec.ts',
  // Wysyłka formularza kontaktu (#61) — sukces tylko w trybie fixture (demo = brak zapisu).
  '**/contact-form.spec.ts',
];

/**
 * Speci z asercją czasu (INP otwarcia dialogu przy CPU 4×, #393). Mierzą czas interakcji, więc
 * biegną w osobnym projekcie na jednym workerze i dopiero PO reszcie zestawu — równoległe
 * karty nie zabierają im CPU. Pozostałe testy nie mierzą czasu i biegną równolegle.
 */
const TIMING_SPECS = ['**/dialog-open-inp.spec.ts'];

/**
 * Podział zestawu demo (projekt `chromium`) na 3 shardy CI PO CZASIE testów, nie po ich
 * liczbie: `--shard` Playwrighta dzieli PLIKI alfabetycznie, a najdłuższe przeglądy axe
 * (a11y*, admin-*, cookie-consent-categories, panel-a11y) leżą blisko siebie w alfabecie —
 * shard 1/3 trwał 7,4 min, 2/3 2,5 min, 3/3 5,1 min (przebieg 36327645914, 27.09.2026).
 *
 * Jak część 2 trybu `full` w playwright.applications-fixture.config.ts: jawna lista speców
 * zamiast `--shard`. Tu DWIE jawne listy (DEMO_SHARD_1_SPECS, DEMO_SHARD_2_SPECS, każda
 * ~280 s zmierzonego czasu testów z ~836 s całości zestawu, dobrane zachłannie z pomiaru
 * per-spec tego przebiegu) i shard 3 = CAŁA RESZTA (dopełnienie, bez własnej listy) — nowy
 * spec trafia tam sam, bez dopisywania. Gdy któryś shard wyraźnie odstaje po kolejnym
 * pomiarze, przesuń spec między listami/resztą.
 *
 * `E2E_DEMO_SHARD=1|2|3` z macierzy `e2e-shard` w .github/workflows/ci.yml (bez `--shard`
 * w komendzie — dzieli tylko ta konfiguracja, inaczej podwójny podział zgubiłby testy).
 * Bez zmiennej (lokalnie) — cały zestaw naraz.
 */
const DEMO_SHARDS = ['1', '2', '3'];
const DEMO_SHARD_1_SPECS = [
  '**/admin-a11y.spec.ts',
  '**/admin-breaches.spec.ts',
  '**/admin-campaign-banner.spec.ts',
  '**/admin-email-campaigns.spec.ts',
  '**/admin-email-suppressions.spec.ts',
  '**/auth-error-focus.spec.ts',
  '**/auth-login-employer-link.spec.ts',
  '**/auth-next-links.spec.ts',
  '**/campaign-banner.spec.ts',
  '**/candidate-application-answers.spec.ts',
  '**/candidate-company-blocks.spec.ts',
  '**/candidate-dashboard-contrast.spec.ts',
  '**/candidate-onboarding-a11y.spec.ts',
  '**/candidate-onboarding.spec.ts',
  '**/candidate-profile-passport.spec.ts',
  '**/candidate-profile-visibility.spec.ts',
  '**/candidate-real-proposal-banner.spec.ts',
  '**/candidate-settings-actions.spec.ts',
  '**/demo-jobs-labelled.spec.ts',
  '**/employer-application-screening.spec.ts',
  '**/employer-candidates-passport.spec.ts',
  '**/employer-dashboard-a11y.spec.ts',
  '**/employer-job-duplicate.spec.ts',
  '**/employer-offer-status-flow.spec.ts',
  '**/employer-offers-passport.spec.ts',
  '**/employer-wizard-passport.spec.ts',
  '**/faq-redirect.spec.ts',
  '**/flows.spec.ts',
  '**/form-control-border-contrast.spec.ts',
  '**/guides-breadcrumb.spec.ts',
  '**/home-hero.spec.ts',
  '**/job-detail-cta-bar.spec.ts',
  '**/job-detail-salary.spec.ts',
  '**/job-detail-sections.spec.ts',
  '**/job-detail-tabs.spec.ts',
  '**/job-passport.spec.ts',
  '**/job-wizard-step9-draft.spec.ts',
  '**/jobs-hub-text-zoom.spec.ts',
  '**/jobs-list-results-focus.spec.ts',
  '**/jobs-list-sidebar-reach.spec.ts',
  '**/landing-city-redirect.spec.ts',
  '**/messages-loading.spec.ts',
  '**/notifications-bell.spec.ts',
  '**/one-time-link-tracking.spec.ts',
  '**/panel-noindex.spec.ts',
  '**/panel-stats-text-zoom.spec.ts',
  '**/saved-search.spec.ts',
  '**/shell-footer-guides.spec.ts',
  '**/shell-locale-switcher.spec.ts',
  '**/shell-not-found-chrome.spec.ts',
];
const DEMO_SHARD_2_SPECS = [
  '**/a11y.spec.ts',
  '**/admin-company-review.spec.ts',
  '**/admin-ux.spec.ts',
  '**/admin-web-vitals.spec.ts',
  '**/auth-age-declaration.spec.ts',
  '**/auth-terms-links.spec.ts',
  '**/candidate-account-data.spec.ts',
  '**/candidate-dashboard-polish.spec.ts',
  '**/candidate-recommended-explanation.spec.ts',
  '**/consent-separation.spec.ts',
  '**/cookie-consent-focus.spec.ts',
  '**/cookie-settings-contrast.spec.ts',
  '**/cv-upload-size.spec.ts',
  '**/dialog-open-cost.spec.ts',
  '**/email-unsubscribe.spec.ts',
  '**/employer-application-detail.spec.ts',
  '**/employer-applications-passport.spec.ts',
  '**/employer-company-passport.spec.ts',
  '**/employer-entry.spec.ts',
  '**/employer-job-edit-published.spec.ts',
  '**/employer-team.spec.ts',
  '**/employers-page.spec.ts',
  '**/guides-reflow.spec.ts',
  '**/help-contact.spec.ts',
  '**/home-photo.spec.ts',
  '**/job-assist.spec.ts',
  '**/job-detail-a11y.spec.ts',
  '**/job-filter-passport.spec.ts',
  '**/job-import.spec.ts',
  '**/job-wizard-screening.spec.ts',
  '**/job-wizard-step-focus.spec.ts',
  '**/jobs-list-chip-reflow.spec.ts',
  '**/jobs-list-filter-navigation.spec.ts',
  '**/jobs-list-header.spec.ts',
  '**/jobs-list-salary-unit.spec.ts',
  '**/landing-breadcrumbs.spec.ts',
  '**/landing-headings.spec.ts',
  '**/message-report.spec.ts',
  '**/messages-back-target.spec.ts',
  '**/messages-mobile.spec.ts',
  '**/panel-a11y.spec.ts',
  '**/passport-panel-a11y.spec.ts',
  '**/prototype-matrix.spec.ts',
  '**/pwa-locale-manifest.spec.ts',
  '**/shell-header-reflow-320.spec.ts',
  '**/shell-mobile-locale.spec.ts',
  '**/shell-nav-a11y.spec.ts',
  '**/shell-offline-fallback.spec.ts',
  '**/smoke.spec.ts',
  '**/static-asset-cache.spec.ts',
  '**/structured-data.spec.ts',
  '**/wizard-stepper-reflow.spec.ts',
];
const DEMO_SHARD = process.env.E2E_DEMO_SHARD ?? '';
if (DEMO_SHARD && !DEMO_SHARDS.includes(DEMO_SHARD)) {
  throw new Error(`E2E_DEMO_SHARD=${DEMO_SHARD}: dozwolone ${DEMO_SHARDS.join(', ')}`);
}
const EXCLUDED_FROM_CHROMIUM = [...FIXTURE_ONLY_SPECS, ...TIMING_SPECS];
for (const [name, specs] of [
  ['DEMO_SHARD_1_SPECS', DEMO_SHARD_1_SPECS],
  ['DEMO_SHARD_2_SPECS', DEMO_SHARD_2_SPECS],
] as const) {
  for (const spec of specs) {
    // Literówka albo usunięty spec = shard cicho mniejszy, reszta i tak go pomija.
    if (!existsSync(join(__dirname, 'tests', 'e2e', spec.replace('**/', '')))) {
      throw new Error(`${name}: ${spec} nie istnieje w tests/e2e`);
    }
    if (EXCLUDED_FROM_CHROMIUM.includes(spec)) {
      throw new Error(`${name}: ${spec} nie należy do projektu chromium`);
    }
  }
}
// Ten sam spec w obu listach trafiłby do dwóch shardów naraz (test uruchomiony podwójnie).
for (const spec of DEMO_SHARD_1_SPECS) {
  if (DEMO_SHARD_2_SPECS.includes(spec)) {
    throw new Error(`DEMO_SHARD_1_SPECS i DEMO_SHARD_2_SPECS: ${spec} w obu listach naraz`);
  }
}

/**
 * Równoległość w CI: hostowany runner `ubuntu-latest` ma 4 vCPU; jeden rdzeń zostaje dla
 * serwera `next start`. Na jednym workerze sam krok „Run E2E” trwał ~25 min.
 */
const CI_WORKERS = 3;

/**
 * Nazwa raportu cząstkowego (blob) w CI: `shard-1`…, `timing` — ustawiają ją joby shardów
 * i pomiaru w .github/workflows/ci.yml. Pusta (lokalnie) = zwykłe reportery.
 */
const BLOB_NAME = (process.env.E2E_BLOB_NAME ?? '').replace(/[^a-z0-9-]/gi, '');

export default defineConfig({
  testDir: './tests/e2e',
  // Te scenariusze wymagają serwera z danymi fikcyjnymi (playwright.applications-fixture.config.ts);
  // na danych demo zawsze by padły.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Niestabilność ma być widoczna (#375). Jedno ponowienie odróżnia test niestabilny
  // od stale czerwonego i zbiera trace ('on-first-retry'), ale test, który przeszedł
  // dopiero przy ponowieniu, i tak czerwieni przebieg (`failOnFlakyTests`). Listę flaków
  // z błędami nieudanych prób wypisuje tests/e2e/reporters/flaky-report.ts (stdout,
  // podsumowanie joba, plik flaky-tests.json); reporter `github` dodaje adnotacje.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: process.env.CI ? CI_WORKERS : undefined,
  reporter: BLOB_NAME
    ? // Shard CI (`--shard=i/N`) albo krok pomiaru: raport cząstkowy (blob) łączy job zbiorczy
      // „E2E (Playwright)” przez `playwright merge-reports` (playwright.merge.config.ts — tam
      // html i raport flaków). `failOnFlakyTests` obowiązuje w każdym shardzie osobno.
      [['line'], ['github'], ['blob', { outputDir: 'blob-report', fileName: `report-${BLOB_NAME}.zip` }]]
    : process.env.CI
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
      // Shard 1/2 = jawna lista (testMatch); shard 3 = dopełnienie (testIgnore obu list).
      ...(DEMO_SHARD === '1' ? { testMatch: DEMO_SHARD_1_SPECS } : {}),
      ...(DEMO_SHARD === '2' ? { testMatch: DEMO_SHARD_2_SPECS } : {}),
      testIgnore: [
        ...FIXTURE_ONLY_SPECS,
        ...TIMING_SPECS,
        ...(DEMO_SHARD === '3' ? [...DEMO_SHARD_1_SPECS, ...DEMO_SHARD_2_SPECS] : []),
      ],
      use: BROWSER,
    },
    {
      name: 'chromium-timing',
      testMatch: TIMING_SPECS,
      // Jeden worker i start po zakończeniu projektu `chromium` = pomiar bez konkurencji o CPU.
      workers: 1,
      dependencies: ['chromium'],
      use: BROWSER,
    },
  ],
  webServer: {
    // CI buduje w osobnym kroku; limit gotowości mierzy wtedy wyłącznie start serwera.
    // `--keepAliveTimeout`: `request`/`page.request` Playwrighta dzielą w workerze jednego agenta
    // HTTP z keep-alive; domyślne 5 s serwera Node zamyka bezczynne gniazdo w chwili, gdy klient
    // wysyła po nim następne żądanie → `read ECONNRESET` (flaky free-mvp-no-sales). 120 s > przerwy
    // między testami jednego workera.
    command: reuseBuild
      ? `npm run start -- -p ${PORT} --keepAliveTimeout ${SERVER_KEEP_ALIVE_MS}`
      : `npm run build && npm run start -- -p ${PORT} --keepAliveTimeout ${SERVER_KEEP_ALIVE_MS}`,
    // Sekret linków wypisania (#45) i atrapa importu AI (#465) czytane w runtime — bez przebudowy.
    env: { ...TRACKER_ENV, ...JOB_IMPORT_ENV, ...JOB_ASSIST_ENV, EMAIL_UNSUBSCRIBE_SECRET: E2E_UNSUBSCRIBE_SECRET },
    url: BASE_URL,
    // Jawne E2E_REUSE_SERVER=1 (poza CI) — np. własny `npm run dev` na tym porcie.
    reuseExistingServer: e2eReuseServer(),
    timeout: reuseBuild ? 180_000 : 900_000,
  },
});
