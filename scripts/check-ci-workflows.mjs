import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import prettier from 'prettier';

// Strażnik workflowów CI na GitHub-hosted runnerach (`ubuntu-latest`; repo publiczne,
// minuty darmowe — decyzja właściciela 2026-09-27). Pilnuje nazw jobów (wymagane checki
// i Railway `Wait for CI`), limitów czasu, kolejności jobów, shardów E2E (podział zestawu
// demo po czasie, nie po liczbie testów) z jobem zbiorczym o stałej nazwie „E2E (Playwright)”
// i tego, że przebiegi main nigdy nie są anulowane.
//
// Użycie: `node scripts/check-ci-workflows.mjs [katalog-workflowów] [playwright.config.ts]` —
// domyślnie `.github/workflows` i konfiguracja z repo; argumenty służą testowi strażnika
// (kopia z celowym błędem).

const root = new URL('../', import.meta.url);
const workflowsDir = process.argv[2]
  ? pathToFileURL(`${process.argv[2].replace(/\/$/, '')}/`)
  : new URL('.github/workflows/', root);
const workflows = ['ci.yml', 'delete-old-runs.yml'];
const sources = new Map();

for (const name of workflows) {
  const source = await readFile(new URL(name, workflowsDir), 'utf8');
  // Parser YAML Prettiera wykrywa błędną składnię obu workflowów.
  await prettier.format(source, { parser: 'yaml' });
  sources.set(name, source);
  assert.ok(!/^\s*runs-on:.*self-hosted/m.test(source), `${name}: CI działa na ubuntu-latest, nie na self-hosted`);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\&/]/g, '\\$&');

const ci = sources.get('ci.yml');
const concurrency = ci.match(/^concurrency:\s*\r?\n((?:^[ \t]+.*\r?\n)+)/m)?.[1];
assert.ok(concurrency, 'ci.yml: brak blokady concurrency');
assert.match(concurrency, /format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| github\.sha/, 'ci.yml: grupa per PR, a dla main per SHA');
assert.match(concurrency, /^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\s*$/m, 'ci.yml: anuluj tylko nieaktualne przebiegi PR, nigdy main');

const jobsStart = ci.match(/^jobs:\s*\r?\n/m);
assert.ok(jobsStart, 'brak sekcji jobs');
const jobsSection = ci.slice(jobsStart.index + jobsStart[0].length);
const jobHeaders = [...jobsSection.matchAll(/^  ([a-z][a-z0-9_-]*):\s*\r?\n/gm)];
const jobs = new Map(
  jobHeaders.map((match, index) => [
    match[1],
    jobsSection.slice(match.index + match[0].length, jobHeaders[index + 1]?.index ?? jobsSection.length),
  ]),
);

// Nazwy wyświetlane są checkami — zmiana nazwy wymaganego checka blokuje scalanie i wdrożenie.
// Joby E2E: 3 shardy + pomiar + fixture'y + tryb ogłoszeniowy + przepływ na PostgreSQL
// (od #1239 blokujący); wynik zbiera `e2e`.
const E2E_PARTS = ['e2e-shard', 'e2e-perf', 'e2e-fixtures', 'e2e-classifieds', 'e2e-real'];
const expected = {
  install: ['Install & cache deps', []],
  lint: ['Lint', ['install']],
  typecheck: ['Typecheck', ['install']],
  unit: ['Unit tests (Vitest)', ['install']],
  sca: ['SCA (npm audit)', []],
  'backup-image': ['Backup image (build + scan)', []],
  build: ['Build (Next.js)', ['lint', 'typecheck', 'unit']],
  rls: ['RLS integration (PostgreSQL 16)', []],
  migrations: ['Migration runner (PostgreSQL 16)', ['install']],
  'e2e-shard': ['E2E shard ${{ matrix.shard }}/3', ['build']],
  'e2e-perf': ['E2E perf (lab CWV + INP)', ['build']],
  'e2e-fixtures': ['E2E fixtures (${{ matrix.fixture }} ${{ matrix.part }})', ['build']],
  'e2e-classifieds': ['E2E classifieds (CLASSIFIEDS_ONLY)', ['build']],
  'e2e-real': ['E2E real flow (PostgreSQL 16)', ['build']],
  e2e: ['E2E (Playwright)', ['build', ...E2E_PARTS]],
};
assert.deepEqual([...jobs.keys()], Object.keys(expected), 'zmieniono listę lub kolejność jobów CI');

const forkGuard = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
for (const [name, body] of jobs) {
  const [title, needs] = expected[name];
  assert.match(body, new RegExp(`^    name: ${escapeRegExp(title)}\\s*$`, 'm'), `${name}: nazwa checka musi zostać „${title}”`);
  const declared = body.match(/^    needs:\s*(.+?)\s*$/m)?.[1];
  const parsed = declared ? declared.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()) : [];
  assert.deepEqual(parsed, needs, `${name}: nieoczekiwane zależności jobu`);
  assert.match(body, /^    runs-on: ubuntu-latest\s*$/m, `${name}: użyj ubuntu-latest`);
  const timeout = Number(body.match(/^    timeout-minutes:\s*(\d+)\s*$/m)?.[1]);
  assert.ok(timeout > 0 && timeout <= 30, `${name}: ustaw timeout-minutes (1–30), żeby zawieszony job nie działał bez końca`);
  // PR z forków nie dostają CI z tego repozytorium (bezpieczeństwo sekretów).
  assert.ok(body.match(/^    if:\s*(.+?)\s*$/m)?.[1].includes(forkGuard), `${name}: brak warunku „bez PR z forków”`);
}

// Vitest ma startować z drzewa odtworzonego przez npm ci, także przy trafieniu
// cache. Sam cache node_modules bywa niekompletny.
const unit = jobs.get('unit');
assert.match(unit, /^          cache: npm\s*$/m, 'unit: użyj cache pobrań npm');
assert.match(unit, /^        run: npm ci --prefer-offline --no-audit --fund=false\s*$/m, 'unit: npm ci musi uruchomić się zawsze');
assert.doesNotMatch(unit, /actions\/cache\/restore@/, 'unit: nie odtwarzaj node_modules');
assert.match(unit, /require\.resolve\('ms'\)/, 'unit: sprawdź zależność przed Vitest');

const BROWSER_JOBS = ['unit', 'e2e-shard', 'e2e-perf', 'e2e-fixtures', 'e2e-classifieds', 'e2e-real'];
for (const name of BROWSER_JOBS) {
  assert.match(jobs.get(name), /npx playwright install --with-deps chromium/, `${name}: hostowany runner potrzebuje Chromium i bibliotek systemowych`);
}
assert.equal((ci.match(/npx playwright install/g) ?? []).length, BROWSER_JOBS.length, `ci.yml: Chromium instalują tylko ${BROWSER_JOBS.join(', ')}`);

// Shardy i pomiar używają builda z jobu build (#127): ten sam klucz cache, weryfikacja
// kompletności, fallback na własny build. Każdy build z testowym tokenem Cloudflare Web Analytics (#234).
const buildKey = 'key: next-build-${{ runner.os }}-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}';
const build = jobs.get('build');
const shard = jobs.get('e2e-shard');
const perf = jobs.get('e2e-perf');
const classifiedsJob = jobs.get('e2e-classifieds');
for (const [name, body] of [['build', build], ['e2e-shard', shard], ['e2e-perf', perf], ['e2e-classifieds', classifiedsJob]]) {
  assert.ok(body.includes(buildKey), `${name}: klucz cache builda musi zawierać SHA, run_id i run_attempt`);
  assert.match(body, /^            !\.next\/cache\s*$/m, `${name}: nie zapisuj .next/cache`);
  assert.match(body, /NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN: e2e-cf-analytics-token-00000000/, `${name}: build z testowym tokenem Cloudflare Web Analytics`);
  assert.match(body, /node scripts\/check-next-build\.mjs/, `${name}: zweryfikuj kompletność .next`);
}
assert.match(build, /uses: actions\/cache\/save@/, 'build: zapisz .next w cache Actions');
assert.doesNotMatch(build, /upload-artifact/, 'build: .next przez cache, nie artefakt (limit storage)');
for (const [name, body] of [['e2e-shard', shard], ['e2e-perf', perf], ['e2e-classifieds', classifiedsJob]]) {
  assert.match(body, /uses: actions\/cache\/restore@[\s\S]*restore-keys: next-build-/, `${name}: odtwórz .next z jobu build`);
  assert.match(body, /^        id: next-build\s*$/m, `${name}: krok weryfikacji builda`);
  assert.match(body, /if: steps\.next-build\.outcome != 'success'/, `${name}: fallback build przy braku/niekompletności`);
  assert.match(body, /PLAYWRIGHT_SKIP_BUILD: '1'/, `${name}: Playwright ma użyć gotowego builda`);
}
assert.equal((ci.match(/npm run build/g) ?? []).length, 4, 'ci.yml: jeden build + fallback w shardach, pomiarze i trybie ogłoszeniowym, bez kolejnych buildów');

// Shardy: liczba w nazwie = liczba w macierzy = liczba dozwolonych wartości `E2E_DEMO_SHARD`
// w playwright.config.ts (`DEMO_SHARDS`); projekt `chromium` (pomiar czasu osobno); bez
// `--shard` w komendzie (konfiguracja sama dzieli zestaw demo jawnymi listami — podwójny
// podział zgubiłby testy); wszystkie shardy do końca; raport cząstkowy (blob) zawsze.
const shardCount = Number(expected['e2e-shard'][0].match(/\/(\d+)$/)[1]);
const shardList = shard.match(/^        shard: \[([^\]]*)\]\s*$/m)?.[1].split(',').map((item) => Number(item.trim()));
assert.deepEqual(shardList, Array.from({ length: shardCount }, (_, index) => index + 1), `e2e-shard: macierz shardów musi być 1..${shardCount}`);
assert.ok(shardCount >= 2 && shardCount <= 4, 'e2e-shard: 2–4 shardy');
assert.match(shard, /^      fail-fast: false\s*$/m, 'e2e-shard: fail-fast: false — raport ze wszystkich shardów');
assert.match(shard, /^        run: npx playwright test --project=chromium\s*$/m, 'e2e-shard: `npx playwright test --project=chromium` bez --shard (podział w konfiguracji)');
assert.doesNotMatch(shard, /^\s*run: .*--shard/m, 'e2e-shard: bez --shard — podział robi E2E_DEMO_SHARD w playwright.config.ts');
assert.ok(shard.includes(`E2E_DEMO_SHARD: \${{ matrix.shard }}`), 'e2e-shard: `E2E_DEMO_SHARD: ${{ matrix.shard }}` zgodne z macierzą');
assert.match(shard, /E2E_BLOB_NAME: shard-\$\{\{ matrix\.shard \}\}/, 'e2e-shard: raport cząstkowy (blob) z nazwą shardu');
assert.match(shard, /if: \$\{\{ !cancelled\(\) \}\}\s*\r?\n\s*with:\s*\r?\n\s*name: blob-report-shard-\$\{\{ matrix\.shard \}\}/, 'e2e-shard: wyślij blob także przy czerwonym shardzie');

// Pomiary czasu w jednym miejscu (#393, #395): projekt `chromium-timing` bez zależności,
// potem lab CWV z INP-proxy na tym samym buildzie; oba przed wysłaniem raportów.
const stepIndex = (body, name) => body.indexOf(`- name: ${name}`);
assert.match(build, /- name: Performance budget \(static\)\s*\r?\n\s*run: node scripts\/perf-budget-static\.mjs/, 'build: krok budżetu statycznego');
assert.ok(
  stepIndex(build, 'Verify build output') < stepIndex(build, 'Performance budget (static)') &&
    stepIndex(build, 'Performance budget (static)') < stepIndex(build, 'Save build for E2E'),
  'build: budżet statyczny po weryfikacji builda, przed zapisem cache',
);
assert.match(perf, /run: npx playwright test --project=chromium-timing --no-deps\s*$/m, 'e2e-perf: projekt chromium-timing bez zależności');
assert.match(perf, /E2E_BLOB_NAME: timing/, 'e2e-perf: raport cząstkowy pomiaru czasu');
assert.match(perf, /- name: Performance budget \(lab CWV\)\s*\r?\n\s*run: node scripts\/perf-lab\.mjs\s*$/m, 'e2e-perf: krok lab CWV');
assert.ok(
  stepIndex(perf, 'Run E2E timing specs') > 0 &&
    stepIndex(perf, 'Run E2E timing specs') < stepIndex(perf, 'Performance budget (lab CWV)') &&
    stepIndex(perf, 'Performance budget (lab CWV)') < perf.indexOf('uses: actions/upload-artifact@'),
  'e2e-perf: INP dialogu, potem lab CWV, potem raporty',
);
for (const [name, body] of jobs) {
  if (name === 'e2e-perf') continue;
  assert.doesNotMatch(body, /run: .*(perf-lab\.mjs|chromium-timing)/, `${name}: pomiary czasu tylko w e2e-perf`);
}

// Fixture'y (`next dev`, dane fikcyjne): tryb `full` w 2 częściach, `error` w jednej. Każdy
// tryb ma w macierzy komplet części 1..N, zgodny z częściami dozwolonymi w konfiguracji
// fixture (inaczej część testów nie uruchomiłaby się nigdzie); raport blob zawsze.
const fixtures = jobs.get('e2e-fixtures');
const fixtureParts = new Map();
for (const [, mode, current, total] of fixtures.matchAll(/^          - \{ fixture: ([a-z]+), part: (\d+)\/(\d+) \}\s*$/gm)) {
  const list = fixtureParts.get(mode) ?? [];
  list.push(`${current}/${total}`);
  fixtureParts.set(mode, list);
}
const partsOf = (count) => Array.from({ length: count }, (_, index) => `${index + 1}/${count}`);
assert.deepEqual([...fixtureParts.keys()], ['full', 'error'], 'e2e-fixtures: tryby full i error w macierzy (include)');
assert.deepEqual(fixtureParts.get('full'), partsOf(2), 'e2e-fixtures: tryb full w częściach 1/2 i 2/2');
assert.deepEqual(fixtureParts.get('error'), partsOf(1), 'e2e-fixtures: tryb error w jednej części 1/1');
assert.match(fixtures, /^      fail-fast: false\s*$/m, 'e2e-fixtures: fail-fast: false — raport ze wszystkich części');
assert.match(fixtures, /TEST_APPLICATIONS_FIXTURE: \$\{\{ matrix\.fixture \}\}/, 'e2e-fixtures: tryb z macierzy');
assert.match(fixtures, /TEST_APPLICATIONS_FIXTURE_PART: \$\{\{ matrix\.part \}\}/, 'e2e-fixtures: część z macierzy');
assert.match(fixtures, /npx playwright test --config playwright\.applications-fixture\.config\.ts\s*$/m, 'e2e-fixtures: konfiguracja fixture');
assert.match(fixtures, /E2E_BLOB_NAME: fixtures-\$\{\{ matrix\.fixture \}\}-\$\{\{ strategy\.job-index \}\}/, 'e2e-fixtures: raport cząstkowy (blob) z nazwą części');
assert.match(fixtures, /if: \$\{\{ !cancelled\(\) \}\}\s*\r?\n\s*with:\s*\r?\n\s*name: blob-report-fixtures-/, 'e2e-fixtures: wyślij blob także przy czerwonej części');
// Ścieżki konfiguracji można podmienić zmiennymi CI_GUARD_* (kontrole ujemne w teście strażnika).
const fixtureConfig = await readFile(process.env.CI_GUARD_FIXTURE_CONFIG ?? new URL('playwright.applications-fixture.config.ts', root), 'utf8');
const allowedParts = fixtureConfig.match(/\(mode === 'full' \? \[([^\]]*)\] : \[([^\]]*)\]\)\.includes\(part\)/);
assert.ok(allowedParts, 'playwright.applications-fixture.config.ts: lista dozwolonych części');
const quoted = (list) => list.split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
assert.deepEqual(quoted(allowedParts[1]), fixtureParts.get('full'), 'fixture config: części full = macierz CI');
assert.deepEqual(quoted(allowedParts[2]), fixtureParts.get('error'), 'fixture config: części error = macierz CI');
assert.match(fixtureConfig, /\['blob', \{ outputDir: 'blob-report'/, 'fixture config: blob do blob-report/');
assert.match(fixtureConfig, /retries: 0,/, 'fixture config: bez ponowień (retries: 0)');

// Tryb ogłoszeniowy (#1166): tryb produkcyjny portalu. Serwer z jawnym
// `E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY` w OBU krokach (bez niego zestaw biegłby na serwerze
// RECRUITMENT i speci ogłoszeniowe byłyby cicho pominięte); demo na buildzie z jobu build
// (projekt `chromium`, konfiguracja sama wybiera `CLASSIFIEDS_SPECS`), fixture bez części
// (konfiguracja wybiera `CLASSIFIEDS_FIXTURE_SPECS`); raporty blob zawsze, krok fixture także
// po czerwonym kroku demo.
const classifiedsRuns = [...classifiedsJob.matchAll(/^      - name: (Run E2E classifieds \((demo|fixtures)\))\s*\r?\n((?:^        .*\r?\n)+)/gm)];
assert.deepEqual(classifiedsRuns.map((m) => m[2]), ['demo', 'fixtures'], 'e2e-classifieds: kroki „Run E2E classifieds (demo)” i „(fixtures)”');
for (const [, step, , body] of classifiedsRuns) {
  assert.match(body, /^          E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY\s*$/m, `e2e-classifieds: ${step} — serwer w trybie ogłoszeniowym (E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY)`);
  assert.doesNotMatch(body, /E2E_DEMO_SHARD|TEST_APPLICATIONS_FIXTURE_PART|--shard/, `e2e-classifieds: ${step} — bez podziału (zestaw wybiera konfiguracja)`);
}
const [demoRun, fixtureRun] = classifiedsRuns.map((m) => m[3]);
assert.match(demoRun, /PLAYWRIGHT_SKIP_BUILD: '1'/, 'e2e-classifieds: demo na buildzie z jobu build');
assert.match(demoRun, /^        run: npx playwright test --project=chromium\s*$/m, 'e2e-classifieds: demo = projekt chromium');
assert.match(demoRun, /E2E_BLOB_NAME: classifieds\s*$/m, 'e2e-classifieds: raport cząstkowy demo');
assert.match(fixtureRun, /^        if: \$\{\{ !cancelled\(\) \}\}\s*$/m, 'e2e-classifieds: krok fixture także po czerwonym kroku demo');
assert.match(fixtureRun, /TEST_APPLICATIONS_FIXTURE: full/, 'e2e-classifieds: fixture w trybie full');
assert.match(fixtureRun, /npx playwright test --config playwright\.applications-fixture\.config\.ts\s*$/m, 'e2e-classifieds: konfiguracja fixture');
assert.match(fixtureRun, /E2E_BLOB_NAME: classifieds-fixtures/, 'e2e-classifieds: raport cząstkowy fixture');
for (const artifact of ['blob-report-classifieds', 'blob-report-classifieds-fixtures']) {
  assert.match(classifiedsJob, new RegExp(`if: \\$\\{\\{ !cancelled\\(\\) \\}\\}\\s*\\r?\\n\\s*with:\\s*\\r?\\n\\s*name: ${artifact}\\s*$`, 'm'), `e2e-classifieds: wyślij ${artifact} także przy porażce`);
}
assert.match(fixtureConfig, /if \(classifieds\) return CLASSIFIEDS_FIXTURE_SPECS;/, 'fixture config: serwer ogłoszeniowy = CLASSIFIEDS_FIXTURE_SPECS');

// Przepływ na PostgreSQL 16 (#351, #66): izolowana baza z „e2e” w nazwie. Od #1239 BLOKUJĄCY
// (bez `continue-on-error`, zależność wymaganego checka „E2E (Playwright)”) i w dwóch trybach:
// RECRUITMENT (przepływy rekrutacyjne) oraz CLASSIFIEDS_ONLY (tryb produkcyjny — speci,
// które przebieg RECRUITMENT pomija, np. `saved-search-classifieds`).
const real = jobs.get('e2e-real');
assert.match(real, /^        image: postgres:16\s*$/m, 'e2e-real: usługa postgres:16');
assert.match(real, /E2E_PGPORT: \$\{\{ job\.services\.postgres\.ports\[5432\] \}\}/, 'e2e-real: port usługi z mapowania');
const realDatabases = [...real.matchAll(/^\s*E2E_PGDATABASE: (\S+)\s*$/gm)].map((match) => match[1]);
assert.ok(realDatabases.length >= 2, 'e2e-real: każdy krok z jawną bazą E2E_PGDATABASE');
for (const name of realDatabases) assert.match(name, /^[a-z0-9_]*e2e[a-z0-9_]*$/, `e2e-real: nazwa bazy musi zawierać „e2e” (${name})`);
assert.match(real, /run: npm run test:e2e:real\s*$/m, 'e2e-real: uruchom `npm run test:e2e:real`');
assert.doesNotMatch(real, /^\s*continue-on-error:/m, 'e2e-real: check blokujący — bez continue-on-error (#1239)');
const realClassifieds = real.match(/^      - name: Run E2E real flow \(classifieds\)\s*\r?\n((?:^        .*\r?\n)+)/m)?.[1];
assert.ok(realClassifieds, 'e2e-real: krok „Run E2E real flow (classifieds)” (tryb produkcyjny, #1239)');
assert.match(realClassifieds, /^          E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY\s*$/m, 'e2e-real: krok classifieds — E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY');
assert.match(realClassifieds, /^        if: \$\{\{ !cancelled\(\) \}\}\s*$/m, 'e2e-real: krok classifieds także po czerwonym kroku RECRUITMENT');
assert.match(realClassifieds, /run: npm run test:e2e:real -- saved-search-classifieds\s*$/m, 'e2e-real: krok classifieds uruchamia saved-search-classifieds');
assert.match(real, /if: failure\(\)\s*\r?\n\s*with:\s*\r?\n\s*name: e2e-real-test-results/, 'e2e-real: artefakt przy porażce');

// Job zbiorczy: stała nazwa wymaganego checka; `always()`, bo pominięty job liczy się jako
// zaliczony check; pada, gdy którakolwiek część nie jest `success`; łączy raporty blob.
const aggregate = jobs.get('e2e');
assert.match(aggregate, /^    if: always\(\) && \(/m, 'e2e: job zbiorczy musi działać także po czerwonym shardzie (always())');
assert.match(aggregate, /RESULTS: \$\{\{ toJSON\(needs\) \}\}/, 'e2e: sprawdź wynik każdej zależności');
assert.match(aggregate, /job\.result !== "success"/, 'e2e: każda zależność inna niż success = czerwony check');
assert.match(aggregate, /npx playwright merge-reports --config playwright\.merge\.config\.ts blob-report/, 'e2e: połącz raporty cząstkowe');
assert.match(aggregate, /pattern: blob-report-\*/, 'e2e: pobierz raporty wszystkich części');
assert.doesNotMatch(aggregate, /playwright install|npm run build/, 'e2e: job zbiorczy nie uruchamia testów');

// Konfiguracja Playwrighta: blob tylko w częściach CI, flaki nadal czerwienią przebieg (#375).
const playwrightConfig = await readFile(process.argv[3] ?? new URL('playwright.config.ts', root), 'utf8');
assert.match(playwrightConfig, /failOnFlakyTests: !!process\.env\.CI,/, 'playwright.config.ts: failOnFlakyTests bez zmian');
assert.match(playwrightConfig, /process\.env\.E2E_BLOB_NAME/, 'playwright.config.ts: reporter blob sterowany E2E_BLOB_NAME');
assert.match(playwrightConfig, /\['blob', \{ outputDir: 'blob-report'/, 'playwright.config.ts: blob do blob-report/');

// Podział zestawu demo po czasie: `DEMO_SHARDS` = macierz e2e-shard jako stringi '1'..'N';
// dwie jawne listy (shard 1 i 2) wskazują istniejące speci projektu `chromium` (nie
// fixture/pomiar), bez powtórzeń między sobą; shard N (ostatni) = dopełnienie obu list —
// każdy test dokładnie raz, bez własnej listy (nowy spec trafia tam sam).
const listOf = (name) => {
  const body = playwrightConfig.match(new RegExp(`^const ${name} = \\[([^\\]]*)\\];`, 'ms'))?.[1];
  assert.ok(body !== undefined, `playwright.config.ts: brak listy ${name}`);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
};
assert.deepEqual(
  listOf('DEMO_SHARDS'),
  Array.from({ length: shardCount }, (_, index) => `${index + 1}`),
  `playwright.config.ts: DEMO_SHARDS musi być '1'..'${shardCount}' (macierz e2e-shard)`,
);
const demoShard1 = listOf('DEMO_SHARD_1_SPECS');
const demoShard2 = listOf('DEMO_SHARD_2_SPECS');
assert.ok(demoShard1.length > 0 && demoShard2.length > 0, 'playwright.config.ts: DEMO_SHARD_1/2_SPECS nie mogą być puste');
const excludedFromChromium = new Set([...listOf('FIXTURE_ONLY_SPECS'), ...listOf('TIMING_SPECS'), ...listOf('CLASSIFIEDS_ONLY_SPECS')]);
const e2eFiles = new Set(await readdir(new URL('tests/e2e/', root)));
for (const [name, specs] of [['DEMO_SHARD_1_SPECS', demoShard1], ['DEMO_SHARD_2_SPECS', demoShard2]]) {
  for (const spec of specs) {
    assert.ok(e2eFiles.has(spec.replace('**/', '')), `playwright.config.ts: ${name} — ${spec} nie istnieje w tests/e2e`);
    assert.ok(!excludedFromChromium.has(spec), `playwright.config.ts: ${name} — ${spec} to spec fixture/pomiaru, nie projektu chromium`);
  }
}
assert.ok(demoShard1.every((spec) => !demoShard2.includes(spec)), 'playwright.config.ts: DEMO_SHARD_1_SPECS i DEMO_SHARD_2_SPECS nie mogą się pokrywać');
assert.match(
  playwrightConfig,
  /DEMO_SHARD === '1' \? \{ testMatch: DEMO_SHARD_1_SPECS \} : \{\}/,
  'playwright.config.ts: shard 1 = testMatch DEMO_SHARD_1_SPECS',
);
assert.match(
  playwrightConfig,
  /DEMO_SHARD === '2' \? \{ testMatch: DEMO_SHARD_2_SPECS \} : \{\}/,
  'playwright.config.ts: shard 2 = testMatch DEMO_SHARD_2_SPECS',
);
assert.match(
  playwrightConfig,
  /DEMO_SHARD === '3' \? \[\.\.\.DEMO_SHARD_1_SPECS, \.\.\.DEMO_SHARD_2_SPECS\] : \[\]/,
  'playwright.config.ts: ostatni shard pomija obie jawne listy (dopełnienie)',
);
// Serwer ogłoszeniowy (#1166) = projekt `chromium` z samym zestawem trybu ogłoszeniowego;
// przy serwerze RECRUITMENT speci wyłącznie ogłoszeniowe są poza projektem (nie w shardach).
assert.ok(listOf('CLASSIFIEDS_ONLY_SPECS').length > 0, 'playwright.config.ts: CLASSIFIEDS_ONLY_SPECS nie może być puste');
for (const spec of [...listOf('CLASSIFIEDS_ONLY_SPECS'), ...listOf('CLASSIFIEDS_SHARED_SPECS')]) {
  assert.ok(e2eFiles.has(spec.replace('**/', '')), `playwright.config.ts: ${spec} (tryb ogłoszeniowy) nie istnieje w tests/e2e`);
}
assert.match(playwrightConfig, /CLASSIFIEDS_SERVER \? \{ testMatch: CLASSIFIEDS_SPECS \} : \{\}/, 'playwright.config.ts: serwer ogłoszeniowy = testMatch CLASSIFIEDS_SPECS');
assert.match(playwrightConfig, /CLASSIFIEDS_SERVER \? \[\] : CLASSIFIEDS_ONLY_SPECS/, 'playwright.config.ts: serwer RECRUITMENT pomija CLASSIFIEDS_ONLY_SPECS');
const mergeConfig = await readFile(new URL('playwright.merge.config.ts', root), 'utf8');
assert.match(mergeConfig, /flaky-report\.ts/, 'playwright.merge.config.ts: raport flaków w połączonym raporcie');

// Typecheck obejmuje też specyfikacje Playwrighta (`tests/e2e`): korzeniowy tsconfig je wyłącza
// (osobne typy przeglądarki), więc `npm run typecheck` musi jawnie sprawdzać `tsconfig.e2e.json`,
// a ten musi obejmować `tests/e2e` (job „Typecheck” woła tylko `npm run typecheck`).
const packageJson = JSON.parse(await readFile(process.argv[4] ?? new URL('package.json', root), 'utf8'));
assert.match(
  packageJson.scripts?.typecheck ?? '',
  /tsc --noEmit -p tsconfig\.e2e\.json/,
  'package.json: skrypt typecheck musi sprawdzać tests/e2e (tsc --noEmit -p tsconfig.e2e.json)',
);
assert.match(ci.match(/^  typecheck:[\s\S]*?(?=^  [a-z][a-z0-9_-]*:\s*$)/m)?.[0] ?? '', /run: npm run typecheck\s*$/m, 'ci.yml: job Typecheck uruchamia npm run typecheck');
const e2eTsconfig = JSON.parse(await readFile(process.env.CI_GUARD_E2E_TSCONFIG ?? new URL('tsconfig.e2e.json', root), 'utf8'));
assert.ok(
  (e2eTsconfig.include ?? []).some((pattern) => pattern.startsWith('tests/e2e/')),
  'tsconfig.e2e.json: include musi obejmować tests/e2e',
);
// #1121: specyfikacje E2E sprawdzane tak samo ściśle jak `src/` — bez wyłączania
// `noUncheckedIndexedAccess` (dziedziczone z tsconfig.json) ani `strict`.
const baseTsconfig = JSON.parse(await readFile(new URL('tsconfig.json', root), 'utf8'));
assert.equal(baseTsconfig.compilerOptions?.noUncheckedIndexedAccess, true, 'tsconfig.json: noUncheckedIndexedAccess musi być włączone');
for (const option of ['noUncheckedIndexedAccess', 'strict']) {
  assert.notEqual(
    e2eTsconfig.compilerOptions?.[option],
    false,
    `tsconfig.e2e.json: nie wyłączaj ${option} dla tests/e2e (#1121)`,
  );
}

// Migration runner (#1246): luka numeracji (numer tymczasowy w PR sesji potomnej) ma własny
// krok z czytelnym komunikatem; reszta integracji biegnie w osobnym kroku bez testu operatora
// loginów (jej wynik nie ginie pod czerwienią luki), a test operatora — tylko przy ciągłej
// numeracji. Na main luka nadal czerwieni job (krok ciągłości), więc wykrywanie zostaje.
const migrationsJob = jobs.get('migrations');
const migrationStep = (name) =>
  migrationsJob.match(new RegExp(`^      - name: ${escapeRegExp(name)}\\s*\\r?\\n((?:^        .*\\r?\\n?)+)`, 'm'))?.[1];
const integrationStep = migrationStep('Verify runtime PostgreSQL isolation');
const numberingStep = migrationStep('Check migration numbering continuity');
const operatorStep = migrationStep('Verify runtime logins operator');
assert.ok(integrationStep && numberingStep && operatorStep, 'migrations: kroki integracji, ciągłości numeracji i operatora loginów (#1246)');
assert.match(integrationStep, /--exclude tests\/integration\/runtime-logins\.test\.ts\s*$/m, 'migrations: integracja bez testu operatora loginów (luka numeracji nie maskuje reszty)');
assert.match(integrationStep, /^        if: \$\{\{ !cancelled\(\) \}\}\s*$/m, 'migrations: integracja biegnie także po czerwonym wcześniejszym kroku');
assert.match(numberingStep, /^        id: numbering\s*$/m, 'migrations: krok ciągłości z id numbering');
assert.match(numberingStep, /run: node scripts\/db\/check-migration-numbering\.mjs\s*$/m, 'migrations: krok ciągłości numeracji');
assert.match(numberingStep, /^        if: \$\{\{ !cancelled\(\) \}\}\s*$/m, 'migrations: ciągłość sprawdzana zawsze (także na main)');
assert.match(operatorStep, /if: \$\{\{ !cancelled\(\) && steps\.numbering\.outcome == 'success' \}\}/, 'migrations: test operatora tylko przy ciągłej numeracji');
assert.match(operatorStep, /vitest\.integration\.config\.ts tests\/integration\/runtime-logins\.test\.ts\s*$/m, 'migrations: test operatora loginów uruchamiany osobno');
assert.doesNotMatch(migrationsJob, /^\s*continue-on-error:/m, 'migrations: bez continue-on-error — luka na main ma czerwienić job');

// Akcje przypięte do SHA commita z komentarzem wersji (#1250): ruchomy tag (`@v7`) może zostać
// przesunięty na inny kod bez zmiany w repozytorium.
for (const [name, source] of sources) {
  for (const [line, action, ref, comment] of source.matchAll(/^\s*(?:- )?uses: ([^@\s]+)@(\S+)(?:\s+#\s*(\S+))?\s*$/gm)) {
    assert.match(ref, /^[0-9a-f]{40}$/, `${name}: ${action} — przypnij do 40-znakowego SHA commita (${line.trim()})`);
    assert.match(comment ?? '', /^v\d+(\.\d+){0,2}$/, `${name}: ${action}@${ref} — komentarz z wersją (# vX.Y.Z)`);
  }
}

// Każda konfiguracja Playwrighta, która uruchamia testy, odrzuca `test.only` w CI (#1241):
// pozostawione `.only` w specu fixture albo real-flow cicho wyłączałoby resztę zestawu.
const PLAYWRIGHT_RUN_CONFIGS = [
  ['playwright.config.ts', playwrightConfig],
  ['playwright.applications-fixture.config.ts', fixtureConfig],
  ['playwright.real-flow.config.ts', await readFile(process.env.CI_GUARD_REAL_CONFIG ?? new URL('playwright.real-flow.config.ts', root), 'utf8')],
];
const rootFiles = await readdir(root);
const runConfigs = rootFiles.filter((file) => /^playwright\..*config\.ts$/.test(file) && file !== 'playwright.merge.config.ts').sort();
assert.deepEqual(runConfigs, PLAYWRIGHT_RUN_CONFIGS.map(([file]) => file).sort(), 'check-ci-workflows.mjs: nowa konfiguracja Playwrighta — dopisz ją do PLAYWRIGHT_RUN_CONFIGS');
for (const [file, source] of PLAYWRIGHT_RUN_CONFIGS) {
  assert.match(source, /^\s*forbidOnly: !!process\.env\.CI,\s*$/m, `${file}: forbidOnly: !!process.env.CI (test.only nie może cicho wyłączyć reszty zestawu)`);
}
// Druga warstwa: ESLint odrzuca `.only` i statyczne `.skip`/`.fixme` testu w tests/ (#1241).
const eslintConfig = JSON.parse(await readFile(process.env.CI_GUARD_ESLINT_CONFIG ?? new URL('.eslintrc.json', root), 'utf8'));
const testOverride = (eslintConfig.overrides ?? []).find((override) => [].concat(override.files ?? []).includes('tests/**'));
const restricted = JSON.stringify(testOverride?.rules?.['no-restricted-syntax'] ?? []);
assert.ok(restricted.includes("property.name='only'"), '.eslintrc.json: reguła no-restricted-syntax na .only w tests/**');
assert.ok(restricted.includes('skip|fixme'), '.eslintrc.json: reguła no-restricted-syntax na statyczne .skip/.fixme w tests/**');

// Speci fixture (#1247): każdy spec wyłączony z zestawu demo (`FIXTURE_ONLY_SPECS`) musi biec
// w konfiguracji fixture (`ERROR_SPECS` ∪ `FULL_SPECS`) i odwrotnie — inaczej spec nie biegnie
// nigdzie albo biegnie na danych demo, gdzie zawsze pada.
const fixtureListOf = (name) => {
  const body = fixtureConfig.match(new RegExp(`^const ${name} = \\[([^\\]]*)\\];`, 'ms'))?.[1];
  assert.ok(body !== undefined, `playwright.applications-fixture.config.ts: brak listy ${name}`);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
};
const fixtureSpecs = [...fixtureListOf('ERROR_SPECS'), ...fixtureListOf('FULL_SPECS')];
assert.equal(new Set(fixtureSpecs).size, fixtureSpecs.length, 'fixture config: spec w ERROR_SPECS i FULL_SPECS naraz');
const fixtureOnly = listOf('FIXTURE_ONLY_SPECS');
for (const spec of fixtureOnly) {
  assert.ok(fixtureSpecs.includes(spec), `FIXTURE_ONLY_SPECS: ${spec} nie biegnie w konfiguracji fixture (ERROR_SPECS ∪ FULL_SPECS) — nie biegnie nigdzie`);
}
for (const spec of fixtureSpecs) {
  assert.ok(fixtureOnly.includes(spec), `fixture config: ${spec} nie jest wyłączony z demo (FIXTURE_ONLY_SPECS) — na danych demo padnie`);
  assert.ok(e2eFiles.has(spec.replace('**/', '')), `fixture config: ${spec} nie istnieje w tests/e2e`);
}

// Obraz usługi kopii bazy (#751): job buduje docker/backup/Dockerfile od zera, uruchamia smoke,
// generuje SBOM i skanuje pakiety skanerem przypiętym do digestu, a bramka rozróżnia awarię
// skanera od wyniku „brak podatności”. Obraz bazowy w Dockerfile przypięty do digestu.
const backupJob = jobs.get('backup-image');
const DIGEST = '@sha256:[0-9a-f]{64}';
assert.match(backupJob, /docker build --pull --no-cache -f docker\/backup\/Dockerfile /, 'backup-image: zbuduj docker/backup/Dockerfile od zera (--pull --no-cache)');
assert.match(backupJob, /bash scripts\/db\/backup-image-smoke\.sh "\$BACKUP_IMAGE"/, 'backup-image: smoke obrazu (scripts/db/backup-image-smoke.sh)');
assert.match(backupJob, new RegExp(`^      TRIVY_IMAGE: aquasec/trivy:\\d+\\.\\d+\\.\\d+${DIGEST}\\s*$`, 'm'), 'backup-image: skaner przypięty do wersji i digestu');
assert.match(backupJob, /--format cyclonedx/, 'backup-image: SBOM CycloneDX');
assert.match(backupJob, /--list-all-pkgs --exit-code 0 --format json/, 'backup-image: raport z listą pakietów (dowód zakresu skanu)');
assert.match(backupJob, /exit 2/, 'backup-image: awaria skanera = błąd, nie wynik „czysto”');
assert.match(backupJob, /node scripts\/security\/backup-image-scan\.mjs/, 'backup-image: bramka podatności (backup-image-scan.mjs)');
assert.match(backupJob, /--exceptions docker\/backup\/vulnerability-exceptions\.json/, 'backup-image: jawny plik wyjątków');
assert.match(backupJob, /uses: actions\/upload-artifact@[\s\S]*name: backup-image-sbom-/, 'backup-image: SBOM jako artefakt');
assert.doesNotMatch(backupJob, /continue-on-error|secrets\./, 'backup-image: bez continue-on-error i bez sekretów');
const backupDockerfile = await readFile(process.env.CI_GUARD_BACKUP_DOCKERFILE ?? new URL('docker/backup/Dockerfile', root), 'utf8');
const fromLines = [...backupDockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);
assert.ok(fromLines.length > 0, 'docker/backup/Dockerfile: brak FROM');
for (const from of fromLines) {
  assert.match(from, new RegExp(`^[a-z0-9./-]+:[A-Za-z0-9._-]+${DIGEST}$`), `docker/backup/Dockerfile: ${from} — przypnij obraz bazowy do digestu (tag@sha256:…)`);
}

const cleanup = sources.get('delete-old-runs.yml');
assert.match(cleanup, /^    runs-on: ubuntu-latest\s*$/m);
assert.match(cleanup, /^    timeout-minutes: \d+\s*$/m);
// Sprzątanie przebiegów nie może kasować historii potrzebnej przy analizie regresji (#1105):
// co najmniej 90 dni i 50 ostatnich przebiegów każdego workflowu (także `main`).
const cleanupNumber = (key) => {
  const matches = [...cleanup.matchAll(new RegExp(`^\\s+${key}:\\s*(\\d+)\\s*$`, 'gm'))];
  assert.equal(matches.length, 1, `delete-old-runs.yml: ${key} musi wystąpić dokładnie raz jako liczba`);
  return Number(matches[0][1]);
};
assert.ok(cleanupNumber('retain_days') >= 90, 'delete-old-runs.yml: retain_days < 90 — znika historia przebiegów main (#1105)');
assert.ok(cleanupNumber('keep_minimum_runs') >= 50, 'delete-old-runs.yml: keep_minimum_runs < 50 — znika historia przebiegów main (#1105)');
assert.doesNotMatch(cleanup, /^\s+check_branch_existence:/m, 'delete-old-runs.yml: check_branch_existence w v2.0.6 nie działa (indexOf === 1) — nie polegaj na nim');
console.log('Workflowy CI: ubuntu-latest, limity czasu, stałe nazwy checków, shardy E2E (podział po czasie), części fixture’ów i tryb ogłoszeniowy z jobem zbiorczym, main bez anulowania.');
