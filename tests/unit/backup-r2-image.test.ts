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
    for (const file of ['scripts/db/lib/backup-s3.mjs', 'scripts/db/lib/backup-s3-core.mjs', 'scripts/db/lib/backup-controls.sh']) {
      expect(existsSync(file), file).toBe(true);
    }
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain('CMD ["bash", "scripts/db/backup.sh"]');
    // Brak sekretów w obrazie.
    expect(dockerfile).not.toMatch(/BACKUP_S3_(ACCESS|SECRET|READ)/);
  });

  it('nie ma Dockerfile w katalogu głównym (usługa web buduje się Railpackiem)', () => {
    expect(existsSync('Dockerfile')).toBe(false);
  });
});
