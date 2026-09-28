// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const code = (text: string) =>
  text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n');

// OPS14-01: kopia i odtworzenie zachowują uprawnienia (GRANT/REVOKE). Dynamiczny dowód
// z kontrolami ujemnymi jest w scripts/db/test-backup.sh (PG16, `npm run test:backup`);
// tu pilnujemy, by nikt po cichu nie wrócił do --no-acl ani nie odpiął kontroli.
const SCRIPTS = ['scripts/db/backup.sh', 'scripts/db/restore-backup.sh', 'scripts/db/verify-restore.sh'];

function usesNoAcl(script: string): boolean {
  return /--no-acl\b|(^|\s)-x(\s|$)/m.test(code(script));
}

describe('Kopia bazy z uprawnieniami (OPS14-01)', () => {
  it.each(SCRIPTS)('%s nie pomija ACL i zostaje przy --no-owner', async path => {
    const script = await read(path);
    expect(usesNoAcl(script)).toBe(false);
    for (const line of code(script).split('\n').filter(l => /\bpg_(dump|restore)\b.*--(format|dbname|no-owner)/.test(l))) {
      expect(line).toContain('--no-owner');
    }
  });

  it('kontrola ujemna: detektor rozpoznaje dawne --no-acl', () => {
    expect(usesNoAcl('pg_dump --format=custom --no-owner --no-acl --file=x')).toBe(true);
    expect(usesNoAcl('pg_restore -x -d x')).toBe(true);
    expect(usesNoAcl('# pg_dump --no-acl (komentarz)\npg_dump --no-owner')).toBe(false);
  });

  it('odtworzenie porównuje odcisk uprawnień i tworzy role wg bootstrapu', async () => {
    const restore = code(await read('scripts/db/restore-backup.sh'));
    expect(restore).toContain('BACKUP_ACL_SQL');
    expect(restore).toContain('expected_acl');
    expect(restore).toContain('restore_prepare_roles');
    expect(code(await read('scripts/db/verify-restore.sh'))).toContain('"$BACKUP_ACL_SQL"');
    expect(code(await read('scripts/db/backup.sh'))).toContain('"aclSha256"');
    const roles = code(await read('scripts/db/lib/restore-roles.sh'));
    expect(roles).toMatch(/nologin nosuperuser/);
    expect(roles).toContain('grant anon, authenticated to pracujbe_app');
  });

  it('test kopii ma kontrole ujemne uprawnień', async () => {
    const test = await read('scripts/db/test-backup.sh');
    expect(test).toContain('--no-acl');
    expect(test).toContain("'manifest formatu 1 (kopia bez uprawnień)'");
    expect(test).toContain('Niezgodność uprawnień');
  });
});
