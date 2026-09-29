import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';

/**
 * Błąd konkretnej migracji (#1105): niesie nazwę pliku i strukturalne pola błędu bazy
 * (SQLSTATE, tabela, kolumna, ograniczenie — nazwy schematu, nie dane). Komunikat sterownika
 * i `detail` mogą zawierać wartości z wierszy, więc nie trafiają do `message` ani do logów
 * (oryginał jest w `cause`); wyjątek: SQLSTATE P0001 — komunikat `RAISE` z samej migracji.
 */
export class MigrationFailure extends Error {
  /** @param {string} migration @param {unknown} cause */
  constructor(migration, cause) {
    const source = typeof cause === 'object' && cause !== null ? /** @type {Record<string, unknown>} */ (cause) : {};
    const sqlstate = safeToken(source.code, /^[0-9A-Z]{5}$/);
    // P0001 = `RAISE EXCEPTION` napisany w samej migracji (np. „niezgodne uprawnienia roli”) —
    // komunikat jest własny i nie niesie danych z wierszy, więc wolno go wypisać. Dla pozostałych
    // SQLSTATE komunikat sterownika (może zawierać wartości) nie jest kopiowany.
    const raised = sqlstate === 'P0001' && typeof source.message === 'string'
      ? source.message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300)
      : '';
    // `cause` zachowuje oryginalny błąd dla kodu wołającego i testów; `main` go nie drukuje.
    super(`Migracja ${migration} nie powiodła się${raised ? `: ${raised}` : '.'}`, { cause });
    this.name = 'MigrationFailure';
    this.migration = migration;
    this.raised = raised || undefined;
    this.sqlstate = sqlstate;
    this.table = safeToken(source.table, /^[A-Za-z0-9_$]{1,63}$/);
    this.column = safeToken(source.column, /^[A-Za-z0-9_$]{1,63}$/);
    this.constraint = safeToken(source.constraint, /^[A-Za-z0-9_$]{1,63}$/);
  }
}

/** @param {unknown} value @param {RegExp} pattern */
function safeToken(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

/**
 * Jedna linia diagnostyczna dla operatora (bez komunikatu sterownika i parametrów SQL):
 * nazwa migracji, SQLSTATE i nazwy obiektów schematu albo kod błędu połączenia (`ECONNREFUSED`).
 * @param {unknown} error
 */
export function describeMigrationError(error) {
  if (error instanceof MigrationFailure) {
    const parts = [`SQLSTATE ${error.sqlstate ?? 'nieznany'}`];
    if (error.table) parts.push(`tabela ${error.table}`);
    if (error.column) parts.push(`kolumna ${error.column}`);
    if (error.constraint) parts.push(`ograniczenie ${error.constraint}`);
    return `przy migracji ${error.migration} (${parts.join(', ')})${error.raised ? `: ${error.raised}` : ''}`;
  }
  const code = safeToken(typeof error === 'object' && error !== null ? /** @type {Record<string, unknown>} */ (error).code : undefined, /^[0-9A-Z_]{3,20}$/);
  if (error instanceof Error && error.message.startsWith('Historia migracji różni się')) {
    return 'historia migracji różni się od plików';
  }
  return code ? `kod błędu ${code}` : 'nieokreślony błąd (poza migracją)';
}

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
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO app_migrations.history (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
      } catch (error) {
        throw new MigrationFailure(migration.name, error);
      }
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
  } catch (error) {
    // Sterownik może umieścić dane i parametry SQL w błędzie — nie wypisujemy ich; tylko
    // nazwa migracji i SQLSTATE (#1105).
    console.error(`Migracja nie powiodła się: ${describeMigrationError(error)}. Sprawdź połączenie, historię i przygotowanie bazy.`);
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
