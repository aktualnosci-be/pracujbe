import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Strażnik workflowów CI (`scripts/check-ci-workflows.mjs`, job `lint`): prawdziwe workflowy
 * przechodzą, a każda z kontroli ujemnych (kopia z jednym celowym błędem) daje czerwony wynik.
 * Pilnuje stałej nazwy wymaganego checka „E2E (Playwright)” po podziale E2E na shardy
 * (podział zestawu demo po czasie testów, `E2E_DEMO_SHARD` = jawne listy speców
 * w playwright.config.ts) i fixture'u `full` na 2 części (macierz = części dozwolone
 * w konfiguracji fixture).
 */
const WORKFLOWS = join(process.cwd(), '.github/workflows');
const FILES = ['ci.yml', 'delete-old-runs.yml'];
const PLAYWRIGHT_CONFIG = join(process.cwd(), 'playwright.config.ts');
const dirs: string[] = [];

function runGuard(dir?: string, config?: string, packageJson?: string, env: Record<string, string> = {}) {
  const args = [
    ...(dir || config || packageJson ? [dir ?? WORKFLOWS] : []),
    ...(config || packageJson ? [config ?? PLAYWRIGHT_CONFIG] : []),
    ...(packageJson ? [packageJson] : []),
  ];
  const result = spawnSync(process.execPath, ['scripts/check-ci-workflows.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

function mutated(edit: (ci: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ci-guard-'));
  dirs.push(dir);
  for (const file of FILES) copyFileSync(join(WORKFLOWS, file), join(dir, file));
  const ci = readFileSync(join(dir, 'ci.yml'), 'utf8');
  const next = edit(ci);
  expect(next, 'mutacja musi zmienić ci.yml').not.toBe(ci);
  writeFileSync(join(dir, 'ci.yml'), next);
  return dir;
}

/** Kopia playwright.config.ts z jednym celowym błędem (workflowy bez zmian). */
function mutatedConfig(edit: (config: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ci-guard-config-'));
  dirs.push(dir);
  const config = readFileSync(PLAYWRIGHT_CONFIG, 'utf8');
  const next = edit(config);
  expect(next, 'mutacja musi zmienić playwright.config.ts').not.toBe(config);
  const file = join(dir, 'playwright.config.ts');
  writeFileSync(file, next);
  return file;
}

/** Kopia dowolnego pliku repozytorium z jednym celowym błędem (ścieżka do kopii). */
function mutatedFile(relativePath: string, edit: (source: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ci-guard-file-'));
  dirs.push(dir);
  const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
  const next = edit(source);
  expect(next, `mutacja musi zmienić ${relativePath}`).not.toBe(source);
  const file = join(dir, relativePath.replace(/^\./, 'dot'));
  writeFileSync(file, next);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('strażnik workflowów CI', () => {
  it('prawdziwe workflowy przechodzą', () => {
    const { code, output } = runGuard();
    expect(output).toContain('shardy E2E (podział po czasie)');
    expect(code).toBe(0);
  });

  it('kopia bez zmian przechodzi (argument katalogu działa)', () => {
    const dir = mutated((ci) => `${ci}\n`);
    expect(runGuard(dir).code).toBe(0);
  });

  it('kopia konfiguracji bez zmian przechodzi (argument konfiguracji działa)', () => {
    expect(runGuard(undefined, mutatedConfig((config) => `${config}\n`)).code).toBe(0);
  });

  const negatives: Array<[string, (ci: string) => string, string]> = [
    ['zmieniona nazwa wymaganego checka', (ci) => ci.replace('name: E2E (Playwright)', 'name: E2E'), 'E2E (Playwright)'],
    ['job zbiorczy bez always()', (ci) => ci.replace('if: always() && (', 'if: ('), 'always()'],
    ['job zbiorczy nie sprawdza wyniku części', (ci) => ci.replace('job.result !== "success"', 'job.result === "failure"'), 'success'],
    ['job zbiorczy bez shardów w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds, e2e-real]', 'needs: [build, e2e-perf, e2e-fixtures, e2e-classifieds, e2e-real]'), 'zależności'],
    ['mianownik shardu ≠ macierz', (ci) => ci.replace('E2E_DEMO_SHARD: ${{ matrix.shard }}', 'E2E_DEMO_SHARD: 9'), 'E2E_DEMO_SHARD'],
    ['shard bez E2E_DEMO_SHARD', (ci) => ci.replace('          E2E_DEMO_SHARD: ${{ matrix.shard }}\n', ''), 'E2E_DEMO_SHARD'],
    // Podwójny podział (konfiguracja jawnymi listami + CLI `--shard`) zgubiłby część testów.
    ['shard z --shard w komendzie', (ci) => ci.replace('run: npx playwright test --project=chromium\n', 'run: npx playwright test --project=chromium --shard=${{ matrix.shard }}/3\n'), '--shard'],
    ['shard z fail-fast', (ci) => ci.replace('      fail-fast: false\n      matrix:\n        shard:', '      fail-fast: true\n      matrix:\n        shard:'), 'fail-fast'],
    // Bez nazwy skryptu lab CWV w tym pliku: stable-screenshot.test szuka testów uruchamiających Chromium po nazwach skryptów.
    ['pomiar czasu poza e2e-perf', (ci) => ci.replace('run: npx playwright test --config playwright.applications-fixture.config.ts', 'run: npx playwright test --config playwright.applications-fixture.config.ts --project=chromium-timing'), 'e2e-perf'],
    // #1239: przepływ na PostgreSQL blokujący i w obu trybach.
    ['e2e-real znowu informacyjny', (ci) => ci.replace('    timeout-minutes: 30\n    services:\n      postgres:', '    timeout-minutes: 30\n    continue-on-error: true\n    services:\n      postgres:'), 'bez continue-on-error'],
    ['job zbiorczy bez e2e-real w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds, e2e-real]', 'needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds]'), 'zależności'],
    ['e2e-real bez kroku trybu ogłoszeniowego', (ci) => ci.replace('      - name: Run E2E real flow (classifieds)\n', '      - name: Run E2E real flow (inny)\n'), 'Run E2E real flow (classifieds)'],
    ['e2e-real classifieds w trybie RECRUITMENT', (ci) => ci.replace('          E2E_PGDATABASE: pracujbe_e2e_real_classifieds\n          E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY\n', '          E2E_PGDATABASE: pracujbe_e2e_real_classifieds\n'), 'E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY'],
    ['e2e-real classifieds bez speca zapisanych wyszukiwań', (ci) => ci.replace('run: npm run test:e2e:real -- saved-search-classifieds\n', 'run: npm run test:e2e:real\n'), 'saved-search-classifieds'],
    // #1246: luka numeracji nie maskuje reszty integracji, a na main nadal czerwieni job.
    ['integracja z testem operatora loginów (luka maskuje resztę)', (ci) => ci.replace(' --exclude tests/integration/runtime-logins.test.ts\n', '\n'), 'integracja bez testu operatora'],
    ['bez kroku ciągłości numeracji', (ci) => ci.replace('        run: node scripts/db/check-migration-numbering.mjs\n', '        run: echo pominięte\n'), 'krok ciągłości numeracji'],
    ['test operatora loginów mimo luki numeracji', (ci) => ci.replace("if: ${{ !cancelled() && steps.numbering.outcome == 'success' }}", 'if: ${{ !cancelled() }}'), 'tylko przy ciągłej numeracji'],
    ['luka numeracji informacyjna', (ci) => ci.replace('    timeout-minutes: 15\n    services:\n      auth:', '    timeout-minutes: 15\n    continue-on-error: true\n    services:\n      auth:'), 'luka na main'],
    // #1250: akcje przypięte do SHA z komentarzem wersji.
    ['akcja na ruchomym tagu', (ci) => ci.replace(/uses: actions\/checkout@[0-9a-f]{40} # v7\.0\.1/, 'uses: actions/checkout@v7'), '40-znakowego SHA'],
    ['akcja przypięta bez komentarza wersji', (ci) => ci.replace(/(uses: actions\/setup-node@[0-9a-f]{40}) # v7\.0\.0/, '$1'), 'komentarz z wersją'],
    ['baza e2e-real bez „e2e” w nazwie', (ci) => ci.replace('E2E_PGDATABASE: pracujbe_e2e_real', 'E2E_PGDATABASE: pracujbe_real'), 'e2e'],
    ['fixture full bez części 2/2', (ci) => ci.replace('          - { fixture: full, part: 2/2 }\n', ''), 'częściach 1/2 i 2/2'],
    ['fixture full w 3 częściach (niezgodne z konfiguracją)', (ci) => ci.replace('          - { fixture: full, part: 2/2 }\n', '          - { fixture: full, part: 2/2 }\n          - { fixture: full, part: 3/3 }\n'), 'częściach 1/2 i 2/2'],
    ['fixture bez części z macierzy', (ci) => ci.replace('          TEST_APPLICATIONS_FIXTURE_PART: ${{ matrix.part }}\n', ''), 'część z macierzy'],
    ['blob fixture tylko przy zielonej części', (ci) => ci.replace("        if: ${{ !cancelled() }}\n        with:\n          name: blob-report-fixtures-", "        if: success()\n        with:\n          name: blob-report-fixtures-"), 'czerwonej części'],
    ['job zbiorczy bez fixture w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds, e2e-real]', 'needs: [build, e2e-shard, e2e-perf, e2e-classifieds, e2e-real]'), 'zależności'],
    // Tryb ogłoszeniowy (#1166): wynik w wymaganym checku, serwer jawnie w trybie ogłoszeniowym.
    ['job zbiorczy bez trybu ogłoszeniowego w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds, e2e-real]', 'needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-real]'), 'zależności'],
    ['tryb ogłoszeniowy (demo) bez E2E_PORTAL_LEGAL_MODE', (ci) => ci.replace("          E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY\n          E2E_BLOB_NAME: classifieds\n", '          E2E_BLOB_NAME: classifieds\n'), 'Run E2E classifieds (demo) — serwer w trybie ogłoszeniowym'],
    ['tryb ogłoszeniowy (fixtures) w trybie RECRUITMENT', (ci) => ci.replace("          E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY\n          TEST_APPLICATIONS_FIXTURE: full\n", "          E2E_PORTAL_LEGAL_MODE: RECRUITMENT\n          TEST_APPLICATIONS_FIXTURE: full\n"), 'Run E2E classifieds (fixtures) — serwer w trybie ogłoszeniowym'],
    ['tryb ogłoszeniowy (demo) z shardem', (ci) => ci.replace("          E2E_BLOB_NAME: classifieds\n", "          E2E_BLOB_NAME: classifieds\n          E2E_DEMO_SHARD: 1\n"), 'bez podziału'],
    ['krok fixture trybu ogłoszeniowego tylko po zielonym demo', (ci) => ci.replace("      - name: Run E2E classifieds (fixtures)\n        if: ${{ !cancelled() }}\n", '      - name: Run E2E classifieds (fixtures)\n'), 'po czerwonym kroku demo'],
    ['tryb ogłoszeniowy bez fallbacku builda', (ci) => ci.replace(/(E2E classifieds \(CLASSIFIEDS_ONLY\)[\s\S]*?)        if: steps\.next-build\.outcome != 'success'\n/, '$1'), 'fallback build'],
    ['self-hosted runner', (ci) => ci.replace('runs-on: ubuntu-latest', 'runs-on: [self-hosted, linux]'), 'self-hosted'],
    ['job bez limitu czasu', (ci) => ci.replace('    timeout-minutes: 20\n    strategy:', '    strategy:'), 'timeout-minutes'],
  ];

  it.each(negatives)('kontrola ujemna: %s', (_label, edit, message) => {
    const { code, output } = runGuard(mutated(edit));
    expect(code).not.toBe(0);
    expect(output).toContain(message);
  });

  const configNegatives: Array<[string, (config: string) => string, string]> = [
    ["DEMO_SHARDS bez '3' (część zestawu demo nigdzie)", (config) => config.replace("const DEMO_SHARDS = ['1', '2', '3'];", "const DEMO_SHARDS = ['1', '2'];"), 'DEMO_SHARDS'],
    [
      'spec shardu 1 nie istnieje',
      (config) => config.replace("  '**/admin-a11y.spec.ts',\n", "  '**/admin-a11y.spec.ts',\n  '**/nie-ma-takiego.spec.ts',\n"),
      'nie istnieje',
    ],
    [
      'spec fixture w shardzie 2',
      (config) => config.replace("  '**/a11y.spec.ts',\n", "  '**/a11y.spec.ts',\n  '**/guest-apply.spec.ts',\n"),
      'fixture',
    ],
    ['pusta lista shardu 1', (config) => config.replace(/const DEMO_SHARD_1_SPECS = \[[\s\S]*?\n\];/, 'const DEMO_SHARD_1_SPECS = [];'), 'puste'],
    [
      'ten sam spec w obu listach shardu',
      (config) => config.replace("  '**/a11y.spec.ts',\n", "  '**/a11y.spec.ts',\n  '**/admin-a11y.spec.ts',\n"),
      'nie mogą się pokrywać',
    ],
    [
      'shard 3 nie pomija listy shardu 2 (duplikaty)',
      (config) => config.replace("...(DEMO_SHARD === '3' ? [...DEMO_SHARD_1_SPECS, ...DEMO_SHARD_2_SPECS] : [])", "...(DEMO_SHARD === '3' ? DEMO_SHARD_1_SPECS : [])"),
      'dopełnienie',
    ],
    [
      'shard 2 bez testMatch (uruchamia cały zestaw)',
      (config) => config.replace("...(DEMO_SHARD === '2' ? { testMatch: DEMO_SHARD_2_SPECS } : {}),\n      ", ''),
      'testMatch DEMO_SHARD_2_SPECS',
    ],
    [
      'serwer ogłoszeniowy uruchamia cały zestaw demo (#1166)',
      (config) => config.replace('      ...(CLASSIFIEDS_SERVER ? { testMatch: CLASSIFIEDS_SPECS } : {}),\n', ''),
      'testMatch CLASSIFIEDS_SPECS',
    ],
    [
      'spec trybu ogłoszeniowego w shardzie 1',
      (config) => config.replace("  '**/admin-a11y.spec.ts',\n", "  '**/admin-a11y.spec.ts',\n  '**/classifieds-process-off.spec.ts',\n"),
      'fixture/pomiaru',
    ],
  ];

  it.each(configNegatives)('kontrola ujemna konfiguracji: %s', (_label, edit, message) => {
    const { code, output } = runGuard(undefined, mutatedConfig(edit));
    expect(code).not.toBe(0);
    expect(output).toContain(message);
  });

  // #1247: spec wyłączony z demo, a zapomniany w konfiguracji fixture, nie biegnie nigdzie.
  it.each<[string, (config: string) => string, string]>([
    [
      'spec w FIXTURE_ONLY_SPECS bez odpowiednika w konfiguracji fixture',
      (config) => config.replace("  '**/contact-form.spec.ts',\n];", "  '**/contact-form.spec.ts',\n  '**/seo.spec.ts',\n];"),
      'nie biegnie nigdzie',
    ],
    [
      'spec konfiguracji fixture niewyłączony z demo',
      (config) => config.replace("  '**/contact-form.spec.ts',\n];", '];'),
      'nie jest wyłączony z demo',
    ],
  ])('kontrola ujemna list fixture (playwright.config.ts): %s', (_label, edit, message) => {
    const { code, output } = runGuard(undefined, mutatedConfig(edit));
    expect(code).not.toBe(0);
    expect(output).toContain(message);
  });

  // #1241 (forbidOnly we wszystkich konfiguracjach, reguła ESLint) i #1247 (listy fixture).
  const fileNegatives: Array<[string, string, string, (source: string) => string, string]> = [
    ['fixture bez forbidOnly', 'CI_GUARD_FIXTURE_CONFIG', 'playwright.applications-fixture.config.ts', (c) => c.replace('  forbidOnly: !!process.env.CI,\n', ''), 'forbidOnly'],
    ['real-flow bez forbidOnly', 'CI_GUARD_REAL_CONFIG', 'playwright.real-flow.config.ts', (c) => c.replace('  forbidOnly: !!process.env.CI,\n', ''), 'forbidOnly'],
    ['real-flow z forbidOnly tylko lokalnie', 'CI_GUARD_REAL_CONFIG', 'playwright.real-flow.config.ts', (c) => c.replace('  forbidOnly: !!process.env.CI,\n', '  forbidOnly: false,\n'), 'forbidOnly'],
    ['ESLint bez reguły na .only', 'CI_GUARD_ESLINT_CONFIG', '.eslintrc.json', (c) => c.replace("MemberExpression[property.name='only']", 'MemberExpression[property.name=\'never\']'), '.only'],
    ['ESLint bez reguły na statyczne .skip', 'CI_GUARD_ESLINT_CONFIG', '.eslintrc.json', (c) => c.replace('^(skip|fixme)$', '^(never)$'), '.skip/.fixme'],
    ['fixture FULL_SPECS bez speca z FIXTURE_ONLY_SPECS', 'CI_GUARD_FIXTURE_CONFIG', 'playwright.applications-fixture.config.ts', (c) => c.replace("  '**/contact-form.spec.ts',\n", ''), 'nie biegnie nigdzie'],
    ['spec w ERROR_SPECS i FULL_SPECS naraz', 'CI_GUARD_FIXTURE_CONFIG', 'playwright.applications-fixture.config.ts', (c) => c.replace("  '**/contact-form.spec.ts',\n", "  '**/contact-form.spec.ts',\n  '**/public-read-failures.spec.ts',\n"), 'naraz'],
  ];

  it.each(fileNegatives)('kontrola ujemna pliku: %s', (_label, variable, file, edit, message) => {
    const { code, output } = runGuard(undefined, undefined, undefined, { [variable]: mutatedFile(file, edit) });
    expect(code).not.toBe(0);
    expect(output).toContain(message);
  });

  it('kopie konfiguracji fixture, real-flow i ESLint bez zmian przechodzą (zmienne CI_GUARD_* działają)', () => {
    const env = {
      CI_GUARD_FIXTURE_CONFIG: mutatedFile('playwright.applications-fixture.config.ts', (c) => `${c}\n`),
      CI_GUARD_REAL_CONFIG: mutatedFile('playwright.real-flow.config.ts', (c) => `${c}\n`),
      CI_GUARD_ESLINT_CONFIG: mutatedFile('.eslintrc.json', (c) => `${c}\n`),
    };
    expect(runGuard(undefined, undefined, undefined, env).code).toBe(0);
  });

  it('kontrola ujemna: typecheck bez tests/e2e (tsconfig.e2e.json)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-guard-pkg-'));
    dirs.push(dir);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.typecheck).toContain('-p tsconfig.e2e.json');
    pkg.scripts.typecheck = 'tsc --noEmit';
    const file = join(dir, 'package.json');
    writeFileSync(file, JSON.stringify(pkg));
    const { code, output } = runGuard(undefined, undefined, file);
    expect(code).not.toBe(0);
    expect(output).toContain('typecheck musi sprawdzać tests/e2e');
  });
});
