import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';

/**
 * Cały przebieg jest jedną transakcją na jednym połączeniu.
 * Błąd SQL lub zmiana historii cofa także wcześniej wykonane pliki tego przebiegu.
 * Z `{ dryRun: true }` nakłada oczekujące pliki w tej samej transakcji, a na końcu
 * zawsze robi ROLLBACK — dowód, że migracje przejdą na danej bazie, bez zapisu.
 * @param {{query: Function}} client Połączony klient, nigdy pula z query().
 * @param {Array<{name:string,sql:string,checksum:string}>} migrations
 * @param {{dryRun?: boolean}} [options]
 */
export async function applyMigrations(client, migrations, { dryRun = false } = {}) {
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
    assertHistoryPrefix(rows, migrations);
    const pending = migrations.slice(rows.length);
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query('INSERT INTO app_migrations.history (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return { applied: dryRun ? 0 : pending.length, total: migrations.length, pending: pending.map(file => file.name) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Historia musi być dokładnym prefiksem: zakaz usunięcia, edycji lub wstawienia wstecz. */
function assertHistoryPrefix(rows, migrations) {
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].name !== migrations[index]?.name || rows[index].checksum !== migrations[index]?.checksum) {
      throw new Error('Historia migracji różni się od plików. Przywróć zastosowane pliki.');
    }
  }
}

/**
 * Tylko odczyt: stan historii względem plików, bez tworzenia schematu, blokad i zapisu.
 * Sesja jest `READ ONLY`, więc nawet błąd w tej funkcji nie zmieni bazy.
 * @param {{query: Function}} client
 * @param {Array<{name:string,sql:string,checksum:string}>} migrations
 * @returns {Promise<{applied: number, total: number, pending: string[]}>}
 */
export async function planMigrations(client, migrations) {
  if (migrations.length === 0) throw new Error('Brak migracji.');
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const { rows: [probe] } = await client.query("SELECT to_regclass('app_migrations.history') AS history");
    const rows = probe.history
      ? (await client.query('SELECT name, checksum FROM app_migrations.history ORDER BY name')).rows
      : [];
    assertHistoryPrefix(rows, migrations);
    return { applied: rows.length, total: migrations.length, pending: migrations.slice(rows.length).map(file => file.name) };
  } finally {
    await client.query('ROLLBACK');
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
