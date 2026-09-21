import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRuntimePool } from '../../src/lib/db/pool';
import { withUserTransaction } from '../../src/lib/db/transaction';

const container = `pracujbe-pool-test-${randomUUID()}`;
const password = randomUUID();
let port: number;
let created = false;
let admin: Pool | undefined;
const pools: Pool[] = [];

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

function connectionString(user: string): string {
  return `postgresql://${user}:${password}@127.0.0.1:${port}/pool_test`;
}

beforeAll(async () => {
  // Własny jednorazowy klaster; żadnego odczytu współdzielonego DATABASE_URL.
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=pool_test', 'postgres:16');
  created = true;
  port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  admin = new Pool({ connectionString: connectionString('postgres'), max: 1, connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  await admin.query(readFileSync(new URL('../../database/bootstrap/0001_roles_and_identity.sql', import.meta.url), 'utf8'));
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  await admin.query('BEGIN');
  for (const filename of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(new URL(filename, migrations), 'utf8'));
  }
  await admin.query(readFileSync(new URL('../../database/auth/0057_better_auth_core.sql', import.meta.url), 'utf8'));
  await admin.query('COMMIT');
  for (const user of ['domain_web', 'auth_web', 'admin_option_web', 'create_role_web', 'extra_role_web']) {
    await admin.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}'
      NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  }
  await admin.query(`GRANT pracujbe_app TO domain_web, create_role_web, extra_role_web;
    GRANT pracujbe_auth TO auth_web;
    GRANT pracujbe_app TO admin_option_web WITH ADMIN OPTION;
    ALTER ROLE create_role_web CREATEROLE;
    GRANT service_role TO extra_role_web;`);
});

afterAll(async () => {
  try { await Promise.all(pools.map((pool) => pool.end())); }
  finally {
    try { await admin?.end(); }
    finally { if (created) docker('rm', '--force', container); }
  }
});

describe('Runtime Pool — rzeczywiste loginy PostgreSQL 16', () => {
  it.each(['postgres', 'admin_option_web', 'create_role_web', 'extra_role_web'])
    ('odrzuca niebezpieczny login %s i zamyka jego połączenie', async (user) => {
      await expect(createRuntimePool(connectionString(user), 'domain'))
        .rejects.toThrow('Nie można uruchomić ograniczonej puli połączeń.');
      // pool.end() zamyka socket klienta; backend PostgreSQL znika asynchronicznie.
      // Nadal wymagamy braku wycieku, ale czekamy na potwierdzenie po stronie serwera.
      // Dla postgres istnieje jedna sesja administratora samego testu.
      await expect.poll(async () => {
        const active = await admin!.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename=$1 AND backend_type='client backend'", [user]);
        return active.rows[0]?.count;
      }, { timeout: 2_000, interval: 25 }).toBe(user === 'postgres' ? 1 : 0);
    });

  it.each(['domain', 'auth'] as const)('inicjalizuje rolę %s na dwóch różnych połączeniach', async (purpose) => {
    const login = purpose === 'domain' ? 'domain_web' : 'auth_web';
    const expectedRole = purpose === 'domain' ? 'pracujbe_app' : 'pracujbe_auth';
    const pool = await createRuntimePool(connectionString(login), purpose);
    pools.push(pool);
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const sql = `SELECT pg_backend_pid() AS pid, current_user AS role, session_user AS login,
        current_setting('search_path') AS path, current_setting('statement_timeout') AS timeout,
        (SELECT rolinherit FROM pg_roles WHERE rolname=session_user) AS inherits`;
      const a = (await first.query(sql)).rows[0];
      const b = (await second.query(sql)).rows[0];
      for (const state of [a, b]) {
        expect(state).toMatchObject({ role: expectedRole, login, path: purpose === 'domain' ? 'public' : 'auth',
          timeout: '30s', inherits: false });
      }
      expect(a.pid).not.toBe(b.pid);
      await expect(first.query('SET ROLE postgres')).rejects.toMatchObject({ code: '42501' });
      await expect(second.query('SET ROLE service_role')).rejects.toMatchObject({ code: '42501' });
    } finally { first.release(); second.release(); }
    if (purpose === 'domain') {
      await withUserTransaction(pool, randomUUID(), async (transaction) => {
        const result = await transaction.query('SELECT current_user AS role') as { rows: { role: string }[] };
        expect(result.rows[0]?.role).toBe('authenticated');
      });
      const state = await pool.query("SELECT current_user AS role, nullif(current_setting('app.current_uid', true), '') AS uid");
      expect(state.rows[0]).toEqual({ role: 'pracujbe_app', uid: null });
    }
  });

  it('oddziela uprawnienia danych i uniemożliwia zamianę puli domeny z auth', async () => {
    const domain = await createRuntimePool(connectionString('domain_web'), 'domain');
    pools.push(domain);
    const auth = await createRuntimePool(connectionString('auth_web'), 'auth');
    pools.push(auth);
    await expect(domain.query('SELECT token FROM auth.sessions')).rejects.toMatchObject({ code: '42501' });
    await expect(auth.query('SELECT id FROM public.profiles')).rejects.toMatchObject({ code: '42501' });
    expect((await auth.query('SELECT token FROM sessions')).rows).toEqual([]);
    await withUserTransaction(domain, randomUUID(), async (transaction) => {
      expect((await transaction.query('SELECT id FROM public.profiles') as { rows: unknown[] }).rows).toEqual([]);
    });
    await expect(createRuntimePool(connectionString('auth_web'), 'domain')).rejects.toThrow();
    await expect(createRuntimePool(connectionString('domain_web'), 'auth')).rejects.toThrow();
  });
});
