import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigrations } from './migrate.mjs';

// Wyłącznie jednorazowy kontener testowy, nigdy URL aplikacji ani produkcji.
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/pracujbe_migration_test') {
  throw new Error('Wymagana izolowana baza pracujbe_migration_test.');
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const occupied = await client.query("SELECT to_regclass('app_migrations.history') AS history, to_regclass('public.migration_probe') AS probe");
  assert.equal(occupied.rows[0].history, null, 'Test wymaga nowej bazy.');
  assert.equal(occupied.rows[0].probe, null, 'Test wymaga nowej bazy.');
  const first = { name: '0001_probe.sql', checksum: 'first', sql: 'CREATE TABLE migration_probe (id integer PRIMARY KEY)' };
  assert.deepEqual(await applyMigrations(client, [first]), { applied: 1, total: 1 });
  assert.equal((await applyMigrations(client, [first])).applied, 0);
  await assert.rejects(applyMigrations(client, [{ ...first, checksum: 'changed' }]));
  await assert.rejects(applyMigrations(client, [{ ...first, name: '0000_inserted.sql' }, first]));
  const second = { name: '0002_insert.sql', checksum: 'second', sql: 'INSERT INTO migration_probe VALUES (1)' };
  const invalid = { name: '0003_invalid.sql', checksum: 'invalid', sql: 'INSERT INTO missing_migration_table VALUES (1)' };
  await assert.rejects(applyMigrations(client, [first, second, invalid]));
  assert.equal((await client.query('SELECT count(*)::int AS n FROM migration_probe')).rows[0].n, 0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM app_migrations.history')).rows[0].n, 1);
  // Dwa migratory widzą ten sam zestaw; tylko jeden wykonuje INSERT bez duplikatu PK.
  const other = new pg.Client({ connectionString: url });
  await other.connect();
  try {
    const outcomes = await Promise.all([applyMigrations(client, [first, second]), applyMigrations(other, [first, second])]);
    assert.deepEqual(outcomes.map(result => result.applied).sort(), [0, 1]);
  } finally {
    await other.end();
  }
  await assert.rejects(applyMigrations(client, [first]));
  assert.equal((await client.query('SELECT count(*)::int AS n FROM migration_probe')).rows[0].n, 1);
  console.log('PostgreSQL: migracje, historia, rollback i współbieżność — PASS');
} finally {
  await client.end();
}
