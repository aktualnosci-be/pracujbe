import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Strażnik workflowów CI (`scripts/check-ci-workflows.mjs`, job `lint`): prawdziwe workflowy
 * przechodzą, a każda z kontroli ujemnych (kopia z jednym celowym błędem) daje czerwony wynik.
 * Pilnuje stałej nazwy wymaganego checka „E2E (Playwright)” po podziale E2E na shardy
 * i fixture'u `full` na 2 części (macierz = części dozwolone w konfiguracji fixture).
 */
const WORKFLOWS = join(process.cwd(), '.github/workflows');
const FILES = ['ci.yml', 'delete-old-runs.yml'];
const dirs: string[] = [];

function runGuard(dir?: string) {
  const result = spawnSync(process.execPath, ['scripts/check-ci-workflows.mjs', ...(dir ? [dir] : [])], {
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

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('strażnik workflowów CI', () => {
  it('prawdziwe workflowy przechodzą', () => {
    const { code, output } = runGuard();
    expect(output).toContain('części fixture’ów z jobem zbiorczym');
    expect(code).toBe(0);
  });

  it('kopia bez zmian przechodzi (argument katalogu działa)', () => {
    const dir = mutated((ci) => `${ci}\n`);
    expect(runGuard(dir).code).toBe(0);
  });

  const negatives: Array<[string, (ci: string) => string, string]> = [
    ['zmieniona nazwa wymaganego checka', (ci) => ci.replace('name: E2E (Playwright)', 'name: E2E'), 'E2E (Playwright)'],
    ['job zbiorczy bez always()', (ci) => ci.replace('if: always() && (', 'if: ('), 'always()'],
    ['job zbiorczy nie sprawdza wyniku części', (ci) => ci.replace('job.result !== "success"', 'job.result === "failure"'), 'success'],
    ['job zbiorczy bez shardów w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures]', 'needs: [build, e2e-perf, e2e-fixtures]'), 'zależności'],
    ['mianownik shardu ≠ macierz', (ci) => ci.replace('--shard=${{ matrix.shard }}/3', '--shard=${{ matrix.shard }}/4'), '--shard'],
    ['shard z fail-fast', (ci) => ci.replace('      fail-fast: false\n      matrix:\n        shard:', '      fail-fast: true\n      matrix:\n        shard:'), 'fail-fast'],
    // Bez nazwy skryptu lab CWV w tym pliku: stable-screenshot.test szuka testów uruchamiających Chromium po nazwach skryptów.
    ['pomiar czasu poza e2e-perf', (ci) => ci.replace('run: npx playwright test --config playwright.applications-fixture.config.ts', 'run: npx playwright test --config playwright.applications-fixture.config.ts --project=chromium-timing'), 'e2e-perf'],
    ['e2e-real jako check blokujący', (ci) => ci.replace('    continue-on-error: true\n    services:', '    services:'), 'informacyjny'],
    ['baza e2e-real bez „e2e” w nazwie', (ci) => ci.replace('E2E_PGDATABASE: pracujbe_e2e_real', 'E2E_PGDATABASE: pracujbe_real'), 'e2e'],
    ['fixture full bez części 2/2', (ci) => ci.replace('          - { fixture: full, part: 2/2 }\n', ''), 'częściach 1/2 i 2/2'],
    ['fixture full w 3 częściach (niezgodne z konfiguracją)', (ci) => ci.replace('          - { fixture: full, part: 2/2 }\n', '          - { fixture: full, part: 2/2 }\n          - { fixture: full, part: 3/3 }\n'), 'częściach 1/2 i 2/2'],
    ['fixture bez części z macierzy', (ci) => ci.replace('          TEST_APPLICATIONS_FIXTURE_PART: ${{ matrix.part }}\n', ''), 'część z macierzy'],
    ['blob fixture tylko przy zielonej części', (ci) => ci.replace("        if: ${{ !cancelled() }}\n        with:\n          name: blob-report-fixtures-", "        if: success()\n        with:\n          name: blob-report-fixtures-"), 'czerwonej części'],
    ['job zbiorczy bez fixture w needs', (ci) => ci.replace('needs: [build, e2e-shard, e2e-perf, e2e-fixtures]', 'needs: [build, e2e-shard, e2e-perf]'), 'zależności'],
    ['self-hosted runner', (ci) => ci.replace('runs-on: ubuntu-latest', 'runs-on: [self-hosted, linux]'), 'self-hosted'],
    ['job bez limitu czasu', (ci) => ci.replace('    timeout-minutes: 20\n    strategy:', '    strategy:'), 'timeout-minutes'],
  ];

  it.each(negatives)('kontrola ujemna: %s', (_label, edit, message) => {
    const { code, output } = runGuard(mutated(edit));
    expect(code).not.toBe(0);
    expect(output).toContain(message);
  });
});
