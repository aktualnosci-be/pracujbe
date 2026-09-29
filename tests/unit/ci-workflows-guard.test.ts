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

function runGuard(dir?: string, config?: string, packageJson?: string) {
  const args = [
    ...(dir || config || packageJson ? [dir ?? WORKFLOWS] : []),
    ...(config || packageJson ? [config ?? PLAYWRIGHT_CONFIG] : []),
    ...(packageJson ? [packageJson] : []),
  ];
  const result = spawnSync(process.execPath, ['scripts/check-ci-workflows.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
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
    ['job zbiorczy bez shardów w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds]', 'needs: [build, e2e-perf, e2e-fixtures, e2e-classifieds]'), 'zależności'],
    ['mianownik shardu ≠ macierz', (ci) => ci.replace('E2E_DEMO_SHARD: ${{ matrix.shard }}', 'E2E_DEMO_SHARD: 9'), 'E2E_DEMO_SHARD'],
    ['shard bez E2E_DEMO_SHARD', (ci) => ci.replace('          E2E_DEMO_SHARD: ${{ matrix.shard }}\n', ''), 'E2E_DEMO_SHARD'],
    // Podwójny podział (konfiguracja jawnymi listami + CLI `--shard`) zgubiłby część testów.
    ['shard z --shard w komendzie', (ci) => ci.replace('run: npx playwright test --project=chromium\n', 'run: npx playwright test --project=chromium --shard=${{ matrix.shard }}/3\n'), '--shard'],
    ['shard z fail-fast', (ci) => ci.replace('      fail-fast: false\n      matrix:\n        shard:', '      fail-fast: true\n      matrix:\n        shard:'), 'fail-fast'],
    // Bez nazwy skryptu lab CWV w tym pliku: stable-screenshot.test szuka testów uruchamiających Chromium po nazwach skryptów.
    ['pomiar czasu poza e2e-perf', (ci) => ci.replace('run: npx playwright test --config playwright.applications-fixture.config.ts', 'run: npx playwright test --config playwright.applications-fixture.config.ts --project=chromium-timing'), 'e2e-perf'],
    ['e2e-real jako check blokujący', (ci) => ci.replace('    continue-on-error: true\n    services:', '    services:'), 'informacyjny'],
    ['baza e2e-real bez „e2e” w nazwie', (ci) => ci.replace('E2E_PGDATABASE: pracujbe_e2e_real', 'E2E_PGDATABASE: pracujbe_real'), 'e2e'],
    ['fixture full bez części 2/2', (ci) => ci.replace('          - { fixture: full, part: 2/2 }\n', ''), 'częściach 1/2 i 2/2'],
    ['fixture full w 3 częściach (niezgodne z konfiguracją)', (ci) => ci.replace('          - { fixture: full, part: 2/2 }\n', '          - { fixture: full, part: 2/2 }\n          - { fixture: full, part: 3/3 }\n'), 'częściach 1/2 i 2/2'],
    ['fixture bez części z macierzy', (ci) => ci.replace('          TEST_APPLICATIONS_FIXTURE_PART: ${{ matrix.part }}\n', ''), 'część z macierzy'],
    ['blob fixture tylko przy zielonej części', (ci) => ci.replace("        if: ${{ !cancelled() }}\n        with:\n          name: blob-report-fixtures-", "        if: success()\n        with:\n          name: blob-report-fixtures-"), 'czerwonej części'],
    ['job zbiorczy bez fixture w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds]', 'needs: [build, e2e-shard, e2e-perf, e2e-classifieds]'), 'zależności'],
    // Tryb ogłoszeniowy (#1166): wynik w wymaganym checku, serwer jawnie w trybie ogłoszeniowym.
    ['job zbiorczy bez trybu ogłoszeniowego w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures, e2e-classifieds]', 'needs: [build, e2e-shard, e2e-perf, e2e-fixtures]'), 'zależności'],
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
