// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';

/**
 * #1114 (TQ2-10) — skrypty testów SQL (test-rls, test-seed, test-backup, test-restore,
 * search-benchmark) nakładają migracje z `scripts/lib/migration-files.sh`, który stosuje reguły
 * produkcyjnego loadera (`scripts/db/migration-files.mjs`): każdy `NNNN_[a-z0-9_]+.sql`, bez
 * powtórzonych numerów, kolejność wg numeru. Dawny wzorzec `0*.sql` pomijał migracje `1000_`+.
 */

const ROOT = process.cwd();
const HELPER = resolve(ROOT, 'scripts/lib/migration-files.sh');

function runHelper(dirs: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-c', `. "${HELPER}"; migration_files "$@"`, 'migration_files', ...dirs], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Dawny wzorzec skryptów (kontrola ujemna): tylko pliki zaczynające się od `0`. */
function runLegacyGlob(dirs: string[]): string[] {
  const script = 'for d in "$@"; do for f in "$d"/0*.sql; do [ -e "$f" ] && printf "%s\\t%s\\n" "$(basename "$f")" "$f"; done; done | LC_ALL=C sort | cut -f2';
  return execFileSync('bash', ['-c', script, 'legacy', ...dirs], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

let root: string;
let domain: string;
let auth: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pracujbe-migration-files-'));
  domain = join(root, 'supabase/migrations');
  auth = join(root, 'database/auth');
  mkdirSync(domain, { recursive: true });
  mkdirSync(auth, { recursive: true });
  mkdirSync(join(root, 'database/bootstrap'), { recursive: true });
  writeFileSync(join(root, 'database/bootstrap/0001_roles_and_identity.sql'), 'SELECT 0;');
  writeFileSync(join(domain, '0001_initial.sql'), 'SELECT 1;');
  writeFileSync(join(auth, '0002_auth.sql'), 'SELECT 2;');
  writeFileSync(join(domain, '0999_late.sql'), 'SELECT 999;');
  writeFileSync(join(domain, '1000_after_rollover.sql'), 'SELECT 1000;');
  writeFileSync(join(domain, 'README.md'), 'nie migracja');
});
afterEach(() => {
  if (!resolve(root).startsWith(join(resolve(tmpdir()), 'pracujbe-migration-files-'))) throw new Error('Nieprawidłowy katalog testu.');
  rmSync(root, { recursive: true, force: true });
});

describe('scripts/lib/migration-files.sh (#1114)', () => {
  it('zwraca ten sam zestaw i kolejność co produkcyjny loader — także migracje od 1000', async () => {
    const out = runHelper([domain, auth]);
    expect(out.status).toBe(0);
    const names = out.stdout.split('\n').filter(Boolean).map((path) => basename(path));
    expect(names).toEqual(['0001_initial.sql', '0002_auth.sql', '0999_late.sql', '1000_after_rollover.sql']);
    const production = (await loadProductionMigrations(root)).map((m: { name: string }) => m.name).slice(1);
    expect(names).toEqual(production);
  });

  it('kontrola ujemna: dawny wzorzec `0*.sql` gubi migrację, którą wdraża produkcja', async () => {
    const legacy = runLegacyGlob([domain, auth]).map((path) => basename(path));
    const production = (await loadProductionMigrations(root)).map((m: { name: string }) => m.name).slice(1);
    expect(legacy).not.toContain('1000_after_rollover.sql');
    expect(legacy).not.toEqual(production);
  });

  it('odrzuca nazwę, którą odrzuciłby produkcyjny loader, zamiast ją pominąć', () => {
    for (const bad of ['0003_Upper.sql', '0003-dash.sql', 'extra.sql', '0003_x.SQL']) {
      const dir = mkdtempSync(join(root, 'bad-'));
      writeFileSync(join(dir, '0001_ok.sql'), 'SELECT 1;');
      writeFileSync(join(dir, bad), 'SELECT 3;');
      const out = runHelper([dir]);
      expect(out.status, bad).not.toBe(0);
      expect(out.stderr).toContain('nieprawidłowa nazwa');
    }
  });

  it('odrzuca powtórzony numer między katalogami, dowiązanie, brak katalogu i pustą listę', () => {
    writeFileSync(join(auth, '0001_duplicate.sql'), 'SELECT 9;');
    expect(runHelper([domain, auth]).stderr).toContain('powtórzony numer');
    rmSync(join(auth, '0001_duplicate.sql'));

    symlinkSync(join(domain, '0001_initial.sql'), join(auth, '0003_link.sql'));
    expect(runHelper([domain, auth]).status).not.toBe(0);
    rmSync(join(auth, '0003_link.sql'));

    expect(runHelper([join(root, 'missing')]).status).not.toBe(0);
    const empty = mkdtempSync(join(root, 'empty-'));
    expect(runHelper([empty]).stderr).toContain('brak migracji');
  });

  it('w repozytorium lista = produkcyjna historia (bez bootstrapu)', async () => {
    const out = runHelper([resolve(ROOT, 'supabase/migrations'), resolve(ROOT, 'database/auth')]);
    expect(out.status).toBe(0);
    const names = out.stdout.split('\n').filter(Boolean).map((path) => basename(path));
    const production = (await loadProductionMigrations(ROOT)).map((m: { name: string }) => m.name).slice(1);
    expect(names).toEqual(production);
  });
});

describe('skrypty testów SQL korzystają z helpera (#1114)', () => {
  const SCRIPTS = ['scripts/test-rls.sh', 'scripts/test-seed.sh', 'scripts/db/test-backup.sh', 'scripts/db/test-restore.sh', 'scripts/db/search-benchmark.sh'];
  const NARROW_GLOB = /\/(?:[0-9]|\[[0-9-]+\])\*\.sql/;

  function shellScripts(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) shellScripts(path, out);
      else if (name.endsWith('.sh')) out.push(path);
    }
    return out;
  }

  it('każdy skrypt nakładający migracje źródłuje helper i woła migration_files', () => {
    for (const path of SCRIPTS) {
      const source = readFileSync(resolve(ROOT, path), 'utf8');
      expect(source, path).toContain('. "$ROOT/scripts/lib/migration-files.sh"');
      expect(source, path).toMatch(/migration_files "\$ROOT\/supabase\/migrations"/);
    }
  });

  it('żaden skrypt nie wybiera migracji zawężonym wzorcem (`0*.sql` itp.)', () => {
    const offenders = shellScripts(resolve(ROOT, 'scripts'))
      .filter((path) => !path.endsWith('scripts/lib/migration-files.sh'))
      .filter((path) => NARROW_GLOB.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it('kontrola ujemna: strażnik wykrywa dawny wzorzec', () => {
    expect(NARROW_GLOB.test('for f in "$ROOT"/supabase/migrations/0*.sql; do')).toBe(true);
    expect(NARROW_GLOB.test('for f in "$ROOT"/database/auth/[0-9]*.sql; do')).toBe(true);
    expect(NARROW_GLOB.test('migration_files "$ROOT/supabase/migrations"')).toBe(false);
  });

  it('helper jest czystym bashem (job „rls” działa w kontenerze postgres:16 bez Node)', () => {
    const source = readFileSync(HELPER, 'utf8');
    expect(source).not.toMatch(/\bnode\b|\bnpx\b|\bpython/);
  });
});
