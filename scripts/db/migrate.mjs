import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';

/**
 * Cały przebieg jest jedną transakcją na jednym połączeniu.
 * Błąd SQL lub zmiana historii cofa także wcześniej wykonane pliki tego przebiegu.
 * @param {{query: Function}} client Połączony klient, nigdy pula z query().
 * @param {Array<{name:string,sql:string,checksum:string}>} migrations
 */
export async function applyMigrations(client, migrations) {
  if (migrations.length === 0) throw new Error('Brak migracji.');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    // Stały identyfikator aplikacji; blokada znika także przy rozłączeniu.
    await client.query('SELECT pg_advisory_xact_lock(724031, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS app_migrations');
    await client.query('REVOKE ALL ON SCHEMA app_migrations FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS app_migrations.history (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('REVOKE ALL ON app_migrations.history FROM PUBLIC');
    const { rows } = await client.query('SELECT name, checksum FROM app_migrations.history ORDER BY name');
    // Historia musi być dokładnym prefiksem: zakaz usunięcia, edycji lub wstawienia wstecz.
    for (let index = 0; index < rows.length; index++) {
      if (rows[index].name !== migrations[index]?.name || rows[index].checksum !== migrations[index]?.checksum) {
        throw new Error('Historia migracji różni się od plików. Przywróć zastosowane pliki.');
      }
    }
    const pending = migrations.slice(rows.length);
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query('INSERT INTO app_migrations.history (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
    }
    await client.query('COMMIT');
    return { applied: pending.length, total: migrations.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function main() {
  // Brak fallbacku do URL aplikacji: migrator wymaga osobnego, jawnego połączenia.
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  const directory = process.env.DB_MIGRATIONS_DIR;
  if (!connectionString || !directory) {
    console.error('Ustaw MIGRATION_DATABASE_URL i DB_MIGRATIONS_DIR dla przygotowanej bazy.');
    return 2;
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    const migrations = await loadMigrations(resolve(directory));
    await client.connect();
    const result = await applyMigrations(client, migrations);
    console.log(`Migracje zakończone: ${result.applied} nowych, ${result.total} łącznie.`);
    return 0;
  } catch {
    // Sterownik może umieścić dane i parametry SQL w błędzie — nie wypisujemy ich.
    console.error('Migracja nie powiodła się. Sprawdź połączenie, historię i przygotowanie bazy.');
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
