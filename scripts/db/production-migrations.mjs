import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';
import { applyMigrations } from './migrate.mjs';

/** Jedna historia bootstrapu i domeny; kolejne zmiany dopisujemy po ostatnim numerze. */
export async function loadProductionMigrations(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const [bootstrap, domain, auth] = await Promise.all([
    loadMigrations(resolve(root, 'database/bootstrap')),
    loadMigrations(resolve(root, 'supabase/migrations')),
    loadMigrations(resolve(root, 'database/auth')),
  ]);
  const initial = bootstrap[0];
  if (bootstrap.length !== 1 || !initial || initial.name !== '0001_roles_and_identity.sql') {
    throw new Error('Bootstrap jest stały. Zmiany dodaj jako nowe migracje domeny.');
  }
  const combined = [...domain, ...auth].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const numbers = new Set(['0000']);
  for (const migration of combined) {
    const number = migration.name.slice(0, 4);
    if (numbers.has(number)) throw new Error('Powtórzony numer migracji między katalogami.');
    numbers.add(number);
  }
  // Osobna nazwa w historii zapobiega kolizji bootstrapu z domenowym 0001.
  return [{ ...initial, name: '0000_bootstrap_roles_and_identity.sql' }, ...combined];
}

export async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    console.error('Ustaw osobny MIGRATION_DATABASE_URL migratora.');
    return 2;
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    const migrations = await loadProductionMigrations();
    await client.connect();
    const result = await applyMigrations(client, migrations);
    console.log(`Migracja produkcyjna: ${result.applied} nowych, ${result.total} łącznie.`);
    return 0;
  } catch {
    console.error('Migracja produkcyjna nie powiodła się. Sprawdź historię i uprawnienia migratora.');
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
