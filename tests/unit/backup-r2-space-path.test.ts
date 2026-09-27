// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * #925 — `scripts/db/lib/backup-s3.mjs` rozpoznawał bezpośrednie uruchomienie porównaniem
 * `import.meta.url === \`file://${process.argv[1]}\``. Gdy ścieżka repozytorium/wdrożenia
 * zawiera spację, `import.meta.url` koduje ją jako `%20`, a `process.argv[1]` ma zwykłą
 * spację — warunek nie pasował, `main()` się nie uruchamiał i proces cicho kończył się
 * kodem 0. `backup.sh` interpretował to jako sukces (konfiguracja rzekomo poprawna, upload
 * rzekomo wysłany), mimo że komenda nic nie zrobiła.
 *
 * Test uruchamia CLI jako prawdziwy podproces (nie import) z repozytorium skopiowanym do
 * katalogu ZE SPACJĄ w nazwie — inaczej `import.meta.url` nigdy nie zawiera `%20` i test nie
 * odtwarza błędu. Bez konfiguracji R2 oczekiwany jest kontrolowany błąd (kod 2, komunikat na
 * stderr), nigdy cichy sukces (kod 0, pusty stdout/stderr).
 */

let dir: string | undefined;

function copyScriptToSpacePath(): string {
  dir = mkdtempSync(join(tmpdir(), 'pracuj be-'));
  const core = resolve(process.cwd(), 'scripts/db/lib/backup-s3-core.mjs');
  const cli = resolve(process.cwd(), 'scripts/db/lib/backup-s3.mjs');
  copyFileSync(core, join(dir, 'backup-s3-core.mjs'));
  copyFileSync(cli, join(dir, 'backup-s3.mjs'));
  return join(dir, 'backup-s3.mjs');
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('backup-s3.mjs — rozpoznanie bezpośredniego uruchomienia ze spacją w ścieżce (#925)', () => {
  it('bez konfiguracji R2 kończy się kodem 2 i komunikatem, nie cichym sukcesem', () => {
    const script = copyScriptToSpacePath();
    expect(script).toContain(' ');

    const result = spawnSync(process.execPath, [script, 'check', 'write'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('BACKUP_S3:');
    expect(result.stdout.trim()).toBe('');
  });

  it('kontrola ujemna: ścieżka BEZ spacji też odmawia bez konfiguracji (ten sam kontrakt)', () => {
    const noSpaceDir = mkdtempSync(join(tmpdir(), 'pracujbe-backup-'));
    try {
      const core = resolve(process.cwd(), 'scripts/db/lib/backup-s3-core.mjs');
      const cli = resolve(process.cwd(), 'scripts/db/lib/backup-s3.mjs');
      copyFileSync(core, join(noSpaceDir, 'backup-s3-core.mjs'));
      copyFileSync(cli, join(noSpaceDir, 'backup-s3.mjs'));
      const script = join(noSpaceDir, 'backup-s3.mjs');

      const result = spawnSync(process.execPath, [script, 'check', 'write'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('BACKUP_S3:');
    } finally {
      rmSync(noSpaceDir, { recursive: true, force: true });
    }
  });

  it('polecenie nieznane też kończy się kodem 2 ze spacją w ścieżce (main() faktycznie się wykonał)', () => {
    const script = copyScriptToSpacePath();

    const result = spawnSync(process.execPath, [script, 'not-a-command'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Nieznane polecenie');
  });
});
