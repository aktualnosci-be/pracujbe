import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';
import { applyMigrations } from './migrate.mjs';

// Operator uruchamia na NOWYM, jednorazowym klastrze: role PostgreSQL są globalne.
// Nigdy nie używamy DATABASE_URL ani nie tworzymy/usuwamy domyślnej bazy.
const connectionString = process.env.BOOTSTRAP_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== '/pracujbe_bootstrap_test'
  || process.env.BOOTSTRAP_TEST_ISOLATED_CLUSTER !== 'yes') {
  throw new Error('Wymagana izolowana baza pracujbe_bootstrap_test i jawne potwierdzenie jednorazowego klastra.');
}
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  const occupied = await client.query("SELECT to_regclass('auth.users') AS users, to_regclass('public.profiles') AS profiles, to_regclass('app_migrations.history') AS history");
  assert.deepEqual(occupied.rows[0], { users: null, profiles: null, history: null }, 'Test wymaga pustej bazy.');
  const bootstrap = await loadMigrations(fileURLToPath(new URL('../../database/bootstrap/', import.meta.url)));
  const migrations = await loadMigrations(fileURLToPath(new URL('../../supabase/migrations/', import.meta.url)));
  await client.query('BEGIN');
  try {
    for (const file of bootstrap) await client.query(file.sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  assert.equal((await applyMigrations(client, migrations)).applied, migrations.length);
  assert.equal((await applyMigrations(client, migrations)).applied, 0);
  const roles = await client.query("SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('pracujbe_app','anon','authenticated')");
  assert.equal(roles.rows.length, 3);
  for (const role of roles.rows) {
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    assert.equal(role.rolcanlogin, false);
  }
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname IN ('public','auth') AND r.rolname IN ('pracujbe_app','anon','authenticated')")).rows[0].n, 0);

  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  await client.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'alice@example.invalid','{\"role\":\"candidate\"}'),($2,'bob@example.invalid','{\"role\":\"employer\"}')", [alice, bob]);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.notification_preferences')).rows[0].n, 2);

  // Pozbawiamy połączenie możliwości odzyskania postgres; testujemy rzeczywistą rolę.
  await client.query('SET SESSION AUTHORIZATION pracujbe_app');
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE authenticated');
  await client.query("SELECT set_config('app.current_uid', $1, true)", [alice]);
  assert.deepEqual((await client.query('SELECT id FROM public.profiles')).rows.map(row => row.id), [alice]);
  await client.query('COMMIT');
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE authenticated');
  assert.equal((await client.query('SELECT auth.uid() AS uid')).rows[0].uid, null, 'Tożsamość nie może przetrwać transakcji.');
  await client.query("SELECT set_config('app.current_uid', $1, true)", [bob]);
  // SECURITY DEFINER jako postgres przechodzi strażnik tworzenia pierwszego ownera.
  const company = await client.query("SELECT public.create_company_with_owner('Firma testowa', 'bootstrap-test') AS id");
  assert.ok(company.rows[0].id);
  await client.query('COMMIT');
  await assert.rejects(client.query('SET ROLE service_role'));
  await assert.rejects(client.query('SET ROLE postgres'));
  await assert.rejects(client.query('SELECT * FROM auth.users'));
  await assert.rejects(client.query('CREATE TABLE public.forbidden_table(id integer)'));
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE authenticated');
  await client.query("SELECT set_config('app.current_uid', $1, true)", [bob]);
  await assert.rejects(client.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [bob]));
  await client.query('ROLLBACK');
  console.log('Bootstrap PostgreSQL: migracje, izolacja ról, tożsamości i RPC — PASS');
} finally {
  await client.end();
}
