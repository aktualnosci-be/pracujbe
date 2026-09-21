import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations } from './migration-files.mjs';
import { applyMigrations } from './migrate.mjs';

// Role są globalne dla klastra: wyłącznie osobny, jednorazowy kontener testowy.
// Nigdy DATABASE_URL/MIGRATION_DATABASE_URL aplikacji. Test nie usuwa istniejących baz.
const connectionString = process.env.AUTH_SCHEMA_TEST_DATABASE_URL;
const target = connectionString ? new URL(connectionString) : null;
if (!target || target.pathname !== '/pracujbe_auth_schema_test'
  || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  || !target.port || process.env.AUTH_SCHEMA_TEST_ISOLATED_CLUSTER !== 'yes') {
  throw new Error('Wymagany jednorazowy lokalny klaster, jawny port i baza pracujbe_auth_schema_test.');
}

const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
const connections = [];
const tables = ['users', 'sessions', 'accounts', 'verifications'];
const denied = error => error.code === '42501';

// Rzeczywisty nieuprzywilejowany login, nie samo SET ROLE na sesji superusera.
async function connectAs(login, role) {
  const password = randomBytes(24).toString('hex');
  assert.match(login, /^auth_schema_[a-z_]+$/);
  if (role) assert.match(role, /^(pracujbe_auth|pracujbe_app|service_role)$/);
  await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  if (role) await admin.query(`GRANT ${role} TO ${login}`);
  const address = new URL(connectionString);
  address.username = login;
  address.password = password;
  const client = new pg.Client({ connectionString: address.href, connectionTimeoutMillis: 10_000 });
  await client.connect();
  connections.push(client);
  if (role) await client.query(`SET ROLE ${role}`);
  return client;
}

async function assertAuthUnreadable(client) {
  for (const table of tables) {
    await assert.rejects(client.query(`SELECT * FROM auth.${table}`), denied,
      `Rola nie może czytać auth.${table}.`);
  }
}

await admin.connect();
try {
  const occupied = await admin.query("SELECT to_regclass('auth.users') AS users, to_regclass('public.profiles') AS profiles, to_regclass('app_migrations.history') AS history");
  assert.deepEqual(occupied.rows[0], { users: null, profiles: null, history: null }, 'Test wymaga pustej bazy.');
  const bootstrap = await loadMigrations(fileURLToPath(new URL('../../database/bootstrap/', import.meta.url)));
  const domain = await loadMigrations(fileURLToPath(new URL('../../supabase/migrations/', import.meta.url)));
  const auth = await loadMigrations(fileURLToPath(new URL('../../database/auth/', import.meta.url)));
  await admin.query('BEGIN');
  try {
    for (const file of bootstrap) await admin.query(file.sql);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  await applyMigrations(admin, domain);
  const originalId = randomUUID();
  await admin.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)',
    [originalId, 'existing@example.invalid', { first_name: 'Jan', last_name: 'Testowy', role: 'candidate', locale: 'pl' }]);
  const originalOid = (await admin.query("SELECT 'auth.users'::regclass::oid AS oid")).rows[0].oid;

  // Zastana uprzywilejowana rola nie może zostać po cichu użyta jako runtime auth.
  await admin.query('CREATE ROLE pracujbe_auth NOLOGIN BYPASSRLS');
  await assert.rejects(applyMigrations(admin, [...domain, ...auth]), /niezgodne uprawnienia/);
  assert.equal((await admin.query("SELECT to_regclass('auth.sessions') AS table_name")).rows[0].table_name, null);
  await admin.query('DROP ROLE pracujbe_auth');

  assert.equal((await applyMigrations(admin, [...domain, ...auth])).applied, auth.length);
  assert.equal((await applyMigrations(admin, [...domain, ...auth])).applied, 0);
  assert.equal((await admin.query("SELECT 'auth.users'::regclass::oid AS oid")).rows[0].oid, originalOid);
  const original = await admin.query('SELECT u.id, p.id AS profile_id, u.name, u.email_verified FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=$1', [originalId]);
  assert.deepEqual(original.rows[0], { id: originalId, profile_id: originalId, name: 'Jan Testowy', email_verified: false });

  const role = (await admin.query("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls FROM pg_roles WHERE rolname='pracujbe_auth'")).rows[0];
  assert.deepEqual(role, { rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolbypassrls: false });
  const columns = (await admin.query("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='auth' AND table_name=ANY($1)", [tables])).rows;
  for (const table of tables) {
    assert.equal(columns.find(c => c.table_name === table && c.column_name === 'id')?.data_type, 'uuid');
    for (const field of ['created_at', 'updated_at']) {
      assert.equal(columns.find(c => c.table_name === table && c.column_name === field)?.data_type, 'timestamp with time zone');
    }
  }
  assert.equal(columns.find(c => c.table_name === 'users' && c.column_name === 'email')?.is_nullable, 'NO');
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname=ANY($1) AND c.relrowsecurity AND c.relowner='postgres'::regrole", [tables])).rows[0].n, tables.length);

  const authClient = await connectAs('auth_schema_auth_login', 'pracujbe_auth');
  await authClient.query('SET search_path=auth');
  const user = (await authClient.query("INSERT INTO users(name,email,raw_user_meta_data) VALUES ('Anna Testowa','anna@example.invalid',$1) RETURNING id,email_verified,created_at,updated_at", [{ role: 'candidate', locale: 'fr' }])).rows[0];
  assert.match(user.id, /^[a-f0-9-]{36}$/);
  assert.equal(user.email_verified, false);
  assert.ok(user.created_at instanceof Date && user.updated_at instanceof Date);
  const profile = (await admin.query('SELECT id,role,signup_locale FROM public.profiles WHERE id=$1', [user.id])).rows[0];
  assert.deepEqual(profile, { id: user.id, role: 'candidate', signup_locale: 'fr' });
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.notification_preferences WHERE profile_id=$1', [user.id])).rows[0].n, 1);
  await assert.rejects(authClient.query("INSERT INTO users(name,email) VALUES ('Duplikat','ANNA@example.invalid')"), error => error.code === '23505');
  await assert.rejects(authClient.query("INSERT INTO users(name,email) VALUES ('Brak',null)"), error => error.code === '23502');

  const session = (await authClient.query("INSERT INTO sessions(user_id,token,expires_at,ip_address,user_agent) VALUES ($1,'test-token',now()+interval '1 day','127.0.0.1','schema-test') RETURNING id", [user.id])).rows[0];
  await assert.rejects(authClient.query("INSERT INTO sessions(user_id,token,expires_at) VALUES ($1,'test-token',now())", [user.id]), error => error.code === '23505');
  await assert.rejects(authClient.query("INSERT INTO sessions(user_id,token,expires_at) VALUES ($1,'orphan-token',now())", [randomUUID()]), error => error.code === '23503');
  const account = (await authClient.query("INSERT INTO accounts(user_id,account_id,provider_id,password) VALUES ($1::uuid,$1::uuid::text,'credential','test-hash-not-a-real-password') RETURNING id", [user.id])).rows[0];
  await assert.rejects(authClient.query("INSERT INTO accounts(user_id,account_id,provider_id) VALUES ($1::uuid,$1::uuid::text,'credential')", [user.id]), error => error.code === '23505');
  await assert.rejects(authClient.query("INSERT INTO accounts(user_id,account_id,provider_id) VALUES ($1,'orphan','credential')", [randomUUID()]), error => error.code === '23503');
  await authClient.query("INSERT INTO accounts(user_id,account_id,provider_id,access_token,refresh_token,access_token_expires_at,refresh_token_expires_at,scope,id_token) VALUES ($1,'external-test','test-provider','test-access','test-refresh',now(),now(),'test-scope','test-id-token')", [user.id]);
  const verification = (await authClient.query("INSERT INTO verifications(identifier,value,expires_at) VALUES ('reset-test','test-value',now()+interval '1 hour') RETURNING id")).rows[0];
  await authClient.query('UPDATE users SET email_verified=true,updated_at=now() WHERE id=$1', [user.id]);
  await authClient.query('UPDATE sessions SET expires_at=now() WHERE id=$1', [session.id]);
  await authClient.query("UPDATE accounts SET password='test-updated-hash' WHERE id=$1", [account.id]);
  await authClient.query("UPDATE verifications SET value='test-updated-value' WHERE id=$1", [verification.id]);
  assert.equal((await authClient.query('SELECT email_verified FROM users WHERE id=$1', [user.id])).rows[0].email_verified, true);
  await assert.rejects(authClient.query('SELECT * FROM public.profiles'), denied);
  await assert.rejects(authClient.query('CREATE TABLE auth.forbidden(id integer)'), denied);
  await assert.rejects(authClient.query('SET ROLE service_role'), denied);
  await assert.rejects(authClient.query('SET ROLE postgres'), denied);

  const appClient = await connectAs('auth_schema_app_login', 'pracujbe_app');
  const serviceClient = await connectAs('auth_schema_service_login', 'service_role');
  const publicClient = await connectAs('auth_schema_public_login');
  for (const client of [appClient, serviceClient, publicClient]) {
    await assertAuthUnreadable(client);
    await assert.rejects(client.query('SET ROLE pracujbe_auth'), denied);
    await assert.rejects(client.query("INSERT INTO auth.verifications(identifier,value,expires_at) VALUES ('forged','forged',now())"), denied);
    await assert.rejects(client.query('DELETE FROM auth.users'), denied);
  }
  for (const name of ['anon', 'authenticated']) {
    await appClient.query(`SET ROLE ${name}`);
    await assertAuthUnreadable(appClient);
    await assert.rejects(appClient.query('SET ROLE pracujbe_auth'), denied);
  }

  // Kontrola ujemna testu poufności: celowo otwieramy SELECT w testowej bazie.
  // Asercja MUSI oblać, po czym przywracamy grant i politykę. Żadnych realnych sekretów.
  await admin.query('GRANT SELECT ON auth.accounts TO authenticated');
  await admin.query('CREATE POLICY test_leak ON auth.accounts FOR SELECT TO authenticated USING (true)');
  await assert.rejects(assertAuthUnreadable(appClient), assert.AssertionError);
  await admin.query('DROP POLICY test_leak ON auth.accounts');
  await admin.query('REVOKE SELECT ON auth.accounts FROM authenticated');
  await assertAuthUnreadable(appClient);

  await authClient.query('DELETE FROM verifications WHERE id=$1', [verification.id]);
  assert.equal((await authClient.query('SELECT count(*)::int AS n FROM verifications')).rows[0].n, 0);
  await authClient.query('DELETE FROM users WHERE id=$1', [user.id]);
  assert.equal((await authClient.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1', [user.id])).rows[0].n, 0);
  assert.equal((await authClient.query('SELECT count(*)::int AS n FROM accounts WHERE user_id=$1', [user.id])).rows[0].n, 0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.profiles WHERE id=$1', [user.id])).rows[0].n, 0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.profiles WHERE id=$1', [originalId])).rows[0].n, 1);
  console.log('Schemat auth: UUID/FK, CRUD, unikalność, izolacja ról, kontrola ujemna i kaskady — PASS. Logowanie nie jest jeszcze wdrożone.');
} finally {
  await Promise.allSettled(connections.map(client => client.end()));
  await admin.end();
}
