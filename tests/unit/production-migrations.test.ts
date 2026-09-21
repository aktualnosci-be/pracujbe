// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pracujbe-production-migrations-'));
  for (const dir of ['database/bootstrap', 'database/auth', 'supabase/migrations']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, 'database/bootstrap/0001_roles_and_identity.sql'), 'SELECT 0;');
  await writeFile(join(root, 'supabase/migrations/0001_initial.sql'), 'SELECT 1;');
  await writeFile(join(root, 'database/auth/0002_auth.sql'), 'SELECT 2;');
});
afterEach(async () => {
  if (!resolve(root).startsWith(join(resolve(tmpdir()), 'pracujbe-production-migrations-'))) throw new Error('Nieprawidłowy katalog testu.');
  await rm(root, { recursive: true, force: true });
});
describe('Pełna historia produkcyjna', () => {
  it('ustawia bootstrap przed domeną i przeplata późniejsze migracje wg numeru', async () => {
    await writeFile(join(root, 'supabase/migrations/0003_later.sql'), 'SELECT 3;');
    expect((await loadProductionMigrations(root)).map(file => file.name)).toEqual([
      '0000_bootstrap_roles_and_identity.sql', '0001_initial.sql', '0002_auth.sql', '0003_later.sql',
    ]);
  });
  it('odrzuca numery powtórzone między katalogami', async () => {
    await writeFile(join(root, 'database/auth/0001_duplicate.sql'), 'SELECT 9;');
    await expect(loadProductionMigrations(root)).rejects.toThrow('Powtórzony numer');
  });
  it('nie dopisuje nowego bootstrapu przed zastosowaną historią', async () => {
    await writeFile(join(root, 'database/bootstrap/0002_new.sql'), 'SELECT 9;');
    await expect(loadProductionMigrations(root)).rejects.toThrow('Bootstrap jest stały');
  });
});
