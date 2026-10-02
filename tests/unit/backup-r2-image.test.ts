// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/** #569: obraz zadania kopii (usługa cron Railway) — spójny z repozytorium, bez wpływu na web. */
const dockerfile = readFileSync('docker/backup/Dockerfile', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };

describe('docker/backup/Dockerfile', () => {
  it('SDK S3 w tej samej wersji co aplikacja, klient PostgreSQL 18, age', () => {
    const version = /ARG AWS_SDK_S3_VERSION=(\S+)/.exec(dockerfile)?.[1];
    expect(version).toBe(pkg.dependencies['@aws-sdk/client-s3']?.replace(/^[\^~]/, ''));
    expect(dockerfile).toMatch(/ARG PG_MAJOR=18\b/);
    expect(dockerfile).toContain('postgresql-client-${PG_MAJOR}');
    expect(dockerfile).toMatch(/install[^\n]*\bage\b/);
  });

  it('kopiuje skrypty kopii i ich biblioteki; uruchamia backup.sh jako użytkownik bez uprawnień', () => {
    expect(dockerfile).toContain('COPY scripts/db/backup.sh scripts/db/restore-backup.sh scripts/db/');
    expect(dockerfile).toContain('COPY scripts/db/lib/ scripts/db/lib/');
    for (const file of ['scripts/db/lib/backup-s3.mjs', 'scripts/db/lib/backup-s3-core.mjs', 'scripts/db/lib/backup-controls.sh', 'scripts/db/lib/restore-roles.sh']) {
      expect(existsSync(file), file).toBe(true);
    }
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain('CMD ["bash", "scripts/db/backup.sh"]');
    // Brak sekretów w obrazie.
    expect(dockerfile).not.toMatch(/BACKUP_S3_(ACCESS|SECRET|READ)/);
  });

  it('#751: obraz bazowy przypięty do digestu (tag@sha256), bez menedżerów pakietów w obrazie', () => {
    const from = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);
    expect(from).toHaveLength(1);
    expect(from[0]).toMatch(/^node:22-bookworm-slim@sha256:[0-9a-f]{64}$/);
    // Kontrola ujemna: sam ruchomy tag nie spełnia reguły.
    expect('node:22-bookworm-slim').not.toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(dockerfile).toMatch(/rm -rf \/usr\/local\/lib\/node_modules\/npm /);
    expect(dockerfile).toContain('/usr/local/bin/npx');
    expect(existsSync('scripts/db/backup-image-smoke.sh')).toBe(true);
    expect(existsSync('docker/backup/vulnerability-exceptions.json')).toBe(true);
  });

  it('#751: Dependabot aktualizuje digest obrazu kopii', () => {
    const dependabot = readFileSync('.github/dependabot.yml', 'utf8');
    expect(dependabot).toMatch(/package-ecosystem: docker\s+directory: \/docker\/backup/);
  });

  it('nie ma Dockerfile w katalogu głównym (usługa web buduje się Railpackiem)', () => {
    expect(existsSync('Dockerfile')).toBe(false);
  });
});
