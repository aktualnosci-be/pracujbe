import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';
import { applyMigrations, planMigrations } from './migrate.mjs';

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

/**
 * MIGRATION_MODE:
 *   status  — tylko odczyt: ile migracji zastosowano i które czekają (domyślne, bezpieczne);
 *   dry-run — nakłada oczekujące migracje w transakcji i zawsze ją wycofuje;
 *   apply   — nakłada i zatwierdza (wymaga jawnego wyboru).
 */
export async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  const mode = process.env.MIGRATION_MODE ?? 'status';
  if (!connectionString) {
    console.error('Ustaw osobny MIGRATION_DATABASE_URL migratora.');
    return 2;
  }
  if (!['status', 'dry-run', 'apply'].includes(mode)) {
    console.error('MIGRATION_MODE musi mieć wartość status, dry-run albo apply.');
    return 2;
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    const migrations = await loadProductionMigrations();
    await client.connect();
    if (mode === 'status') {
      const plan = await planMigrations(client, migrations);
      console.log(`Stan migracji: ${plan.applied} zastosowanych, ${plan.pending.length} oczekujących, ${plan.total} łącznie.`);
      for (const name of plan.pending) console.log(`  oczekuje: ${name}`);
      return 0;
    }
    const result = await applyMigrations(client, migrations, { dryRun: mode === 'dry-run' });
    if (mode === 'dry-run') {
      console.log(`Próba migracji: ${result.pending.length} oczekujących przeszło i zostało wycofanych (ROLLBACK), ${result.total} łącznie.`);
    } else {
      console.log(`Migracja produkcyjna: ${result.applied} nowych, ${result.total} łącznie.`);
    }
    return 0;
  } catch {
    // Sterownik może umieścić dane i parametry SQL w błędzie — nie wypisujemy ich.
    console.error('Migracja produkcyjna nie powiodła się. Sprawdź historię i uprawnienia migratora.');
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
