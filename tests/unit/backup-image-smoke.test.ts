// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * #751: smoke obrazu kopii (scripts/db/backup-image-smoke.sh) na atrapie `docker` —
 * prawdziwy obraz buduje i sprawdza job CI „Backup image (build + scan)”. Tu: skrypt odrzuca
 * obraz działający jako root, zły klient PostgreSQL, brak narzędzi, złą wersję SDK, inny kod
 * startu bez konfiguracji i wypisanie wartości zmiennej (kontrole ujemne).
 */
const dir = mkdtempSync(join(tmpdir(), 'backup-smoke-'));
const fakeDocker = join(dir, 'docker');
writeFileSync(
  fakeDocker,
  `#!/usr/bin/env bash
# Atrapa: docker run --rm --network none [-e K=V ...] <obraz> [polecenie...]
shift 4
leak=''
while [ "\${1:-}" = '-e' ]; do leak="$leak \${2#*=}"; shift 2; done
shift # obraz
case "\${1:-}" in
  id) [ "\${2:-}" = '-u' ] && echo "\${FAKE_UID:-1000}" || echo "\${FAKE_USER:-node}" ;;
  node)
    if [ "\${2:-}" = '--version' ]; then echo "\${FAKE_NODE:-v22.23.3}"; else echo "\${FAKE_SDK:-3.1137.0}"; fi ;;
  pg_dump|pg_restore|psql)
    [ "$1" = "\${FAKE_MISSING:-}" ] && exit 127
    echo "$1 (PostgreSQL) \${FAKE_PG:-18.4 (Debian 18.4-1.pgdg120+1)}" ;;
  sh) [ -n "\${FAKE_NPM:-}" ] && { echo /usr/local/bin/npm; exit 0; }; exit 1 ;;
  age) [ -n "\${FAKE_NO_AGE:-}" ] && exit 127; echo v1.1.1 ;;
  '')
    echo 'BACKUP: Ustaw BACKUP_DIR.' >&2
    [ -n "\${FAKE_LEAK:-}" ] && echo "url:$leak" >&2
    exit "\${FAKE_START_CODE:-2}" ;;
  *) exit 99 ;;
esac
`,
);
chmodSync(fakeDocker, 0o755);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function smoke(env: Record<string, string> = {}) {
  const result = spawnSync('bash', ['scripts/db/backup-image-smoke.sh', 'pracujbe-backup:test'], {
    encoding: 'utf8',
    env: { ...process.env, DOCKER: fakeDocker, ...env },
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

describe('scripts/db/backup-image-smoke.sh', () => {
  it('obraz zgodny przechodzi (wersja SDK z package.json)', () => {
    const { code, output } = smoke();
    expect(output).toContain('BACKUP_IMAGE_SMOKE: ok');
    expect(code).toBe(0);
  });

  it.each([
    ['obraz jako root', { FAKE_UID: '0' }, 'działa jako root'],
    ['inny użytkownik', { FAKE_USER: 'app' }, 'nieoczekiwany użytkownik'],
    ['node 20', { FAKE_NODE: 'v20.19.0' }, 'oczekiwany v22'],
    ['klient PostgreSQL 17', { FAKE_PG: '17.6' }, 'oczekiwany PostgreSQL 18'],
    ['klient PostgreSQL 180 (nie myli z 18)', { FAKE_PG: '180.1' }, 'oczekiwany PostgreSQL 18'],
    ['brak pg_restore', { FAKE_MISSING: 'pg_restore' }, 'brak pg_restore'],
    ['obraz z npm', { FAKE_NPM: '1' }, 'menedżer pakietów'],
    ['brak age', { FAKE_NO_AGE: '1' }, 'brak age'],
    ['inna wersja SDK S3', { FAKE_SDK: '3.1000.0' }, 'oczekiwana'],
    ['start bez konfiguracji z kodem 0', { FAKE_START_CODE: '0' }, 'kodem 0 (oczekiwany 2)'],
    ['start wypisuje wartość zmiennej', { FAKE_LEAK: '1' }, 'wypisał wartość zmiennej'],
  ])('kontrola ujemna: %s', (_name, env, message) => {
    const { code, output } = smoke(env);
    expect(code).toBe(1);
    expect(output).toContain(message);
  });

  it('bez nazwy obrazu kończy się błędem', () => {
    const result = spawnSync('bash', ['scripts/db/backup-image-smoke.sh'], { encoding: 'utf8', env: { ...process.env, DOCKER: fakeDocker } });
    expect(result.status).toBe(1);
  });
});
