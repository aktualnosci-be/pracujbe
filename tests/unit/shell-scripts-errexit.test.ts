import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Strażnik skryptów powłoki w `scripts/`: każdy uruchamiany skrypt ma `set -euo pipefail`
 * jako PIERWSZE polecenie (osobna linia, nie dopisek do komentarza), a każde wywołanie `psql`
 * ma `ON_ERROR_STOP=1`. Regresja z f2e987e9 (#1011): `set -euo pipefail` doklejone na końcu
 * linii komentarza w `scripts/test-rls.sh` — skrypt nie przerywał się na nieudanej asercji
 * i kończył kodem 0 (job „RLS integration (PostgreSQL 16)” zielony mimo `ASSERT FAILED`).
 */
const ROOT = process.cwd();
const SCRIPTS = join(ROOT, 'scripts');

/** Biblioteki dołączane przez `.` / `source` — dziedziczą opcje skryptu wołającego. */
const isSourcedLibrary = (file: string) => /(^|\/)lib\//.test(file);

/**
 * Jawne wyjątki: `sca-audit.sh` celowo bez `-e` — sam odczytuje kod wyjścia `npm audit`
 * i klasyfikuje wynik (`scripts/lib/sca-audit-outcome.mjs`); `-u` i `pipefail` zostają.
 */
const EXPECTED_FIRST_COMMAND: Record<string, string> = {
  'scripts/sca-audit.sh': 'set -uo pipefail',
};

function listShellScripts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listShellScripts(path));
    else if (entry.endsWith('.sh')) out.push(relative(ROOT, path));
  }
  return out.sort();
}

/** Pierwsza linia, która jest poleceniem (nie pusta, nie komentarz, nie shebang). */
function firstCommand(source: string): string | null {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}

/** Wywołania `psql` (polecenie, element tablicy, coproc) bez `ON_ERROR_STOP=1`. */
function psqlWithoutErrorStop(source: string): string[] {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .filter((line) => /(^|[\s({;|&])psql\s+-/.test(line))
    .filter((line) => !/ON_ERROR_STOP=1/.test(line));
}

const scripts = listShellScripts(SCRIPTS);
const entryScripts = scripts.filter((file) => !isSourcedLibrary(file));

describe('skrypty powłoki w scripts/', () => {
  it('znajduje skrypty testowe (sanity)', () => {
    expect(entryScripts).toEqual(expect.arrayContaining(['scripts/test-rls.sh', 'scripts/test-seed.sh', 'scripts/db/test-backup.sh']));
  });

  it.each(entryScripts)('%s: pierwsze polecenie to `set -euo pipefail` (osobna linia)', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source.startsWith('#!/usr/bin/env bash\n') || source.startsWith('#!/bin/bash\n')).toBe(true);
    expect(firstCommand(source)).toBe(EXPECTED_FIRST_COMMAND[file] ?? 'set -euo pipefail');
  });

  it.each(scripts)('%s: każde wywołanie psql ma ON_ERROR_STOP=1', (file) => {
    expect(psqlWithoutErrorStop(readFileSync(join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('wyjątki wskazują istniejące skrypty', () => {
    for (const file of Object.keys(EXPECTED_FIRST_COMMAND)) expect(entryScripts).toContain(file);
  });
});

describe('kontrole ujemne', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('`set -euo pipefail` doklejone do komentarza nie jest poleceniem (regresja f2e987e9)', () => {
    const glued = '#!/usr/bin/env bash\n# =====# opis\n# =====set -euo pipefail\n\nfalse\necho dalej\n';
    expect(firstCommand(glued)).toBe('false');

    const dir = mkdtempSync(join(tmpdir(), 'errexit-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'glued.sh'), glued);
    writeFileSync(join(dir, 'fixed.sh'), glued.replace('# =====set -euo pipefail', '# =====\nset -euo pipefail'));
    const gluedRun = spawnSync('bash', [join(dir, 'glued.sh')], { encoding: 'utf8' });
    const fixedRun = spawnSync('bash', [join(dir, 'fixed.sh')], { encoding: 'utf8' });
    expect(gluedRun.status).toBe(0);
    expect(gluedRun.stdout).toContain('dalej');
    expect(fixedRun.status).not.toBe(0);
    expect(fixedRun.stdout).not.toContain('dalej');
  });

  it('psql bez ON_ERROR_STOP=1 jest wykrywany', () => {
    expect(psqlWithoutErrorStop('psql_base=(psql -X -q)\n')).toHaveLength(1);
    expect(psqlWithoutErrorStop('dst() { psql -X -q --dbname="$URL" "$@"; }\n')).toHaveLength(1);
    expect(psqlWithoutErrorStop('psql_base=(psql -v ON_ERROR_STOP=1 -X -q)\ncommand -v psql >/dev/null\n# psql -X\n')).toEqual([]);
  });

  it('scripts/test-rls.sh kończy się kodem ≠ 0 na pierwszym nieudanym psql', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-psql-'));
    dirs.push(dir);
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'psql'), `#!/usr/bin/env bash\necho "$*" >> "${log}"\necho 'ASSERT FAILED: atrapa' >&2\nexit 3\n`);
    chmodSync(join(dir, 'psql'), 0o755);
    const run = spawnSync('bash', [join(SCRIPTS, 'test-rls.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RLS_TEST_DB: 'fake_rls_errexit', HOME: dir },
    });
    expect(run.status).toBe(3);
    expect(run.stdout).not.toContain('sprzątanie');
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});
