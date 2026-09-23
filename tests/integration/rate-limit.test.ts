import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabaseRateLimit, type DatabaseRateLimitOptions } from '../../src/lib/db/rate-limit';
import { withUserTransaction } from '../../src/lib/db/transaction';

const container = `pracujbe-limiter-test-${randomUUID()}`;
const password = randomUUID();
const keySecret = randomUUID();
let created = false;
let admin: Pool | undefined;
let limiter: Pool | undefined;
let domain: Pool | undefined;
let domainFunctionPrivileges: Record<string, unknown>[];

const domainFunctionPrivilegesSql = `SELECT p.oid::regprocedure::text AS signature,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','auth') ORDER BY signature`;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

function options(overrides: Partial<DatabaseRateLimitOptions> = {}): DatabaseRateLimitOptions {
  return { action: 'signin', trustedClientIp: '192.0.2.1', identifier: randomUUID(),
    max: 3, windowSeconds: 60, keySecret, ...overrides };
}

beforeAll(async () => {
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=limiter_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const connection = { host: '127.0.0.1', port, database: 'limiter_test', password, connectionTimeoutMillis: 10_000 };
  admin = new Pool({ ...connection, user: 'postgres', max: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  await admin.query(readFileSync(new URL('../../database/bootstrap/0001_roles_and_identity.sql', import.meta.url), 'utf8'));
  // Kolejność jak w produkcji (scripts/db/production-migrations.mjs, test-rls.sh): pliki
  // domenowe i auth razem, po nazwie. Migracja późniejsza niż auth (np. 0069) widzi wtedy
  // obiekty auth tak samo jak na Railway.
  const migrationFiles = ['../../supabase/migrations/', '../../database/auth/']
    .flatMap((dir) => {
      const base = new URL(dir, import.meta.url);
      return readdirSync(base).filter((name) => /^\d{4}_.+\.sql$/.test(name))
        .map((name) => ({ name, url: new URL(name, base) }));
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  await admin.query('BEGIN');
  for (const { name, url } of migrationFiles) {
    if (name === '0058_rate_limit_role.sql') {
      domainFunctionPrivileges = (await admin.query(domainFunctionPrivilegesSql)).rows;
    }
    await admin.query(readFileSync(url, 'utf8'));
    if (name === '0058_rate_limit_role.sql') {
      expect((await admin.query(domainFunctionPrivilegesSql)).rows).toEqual(domainFunctionPrivileges);
    }
  }
  await admin.query('COMMIT');
  await admin.query(`CREATE ROLE limiter_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_rate_limit TO limiter_web;
    CREATE ROLE normal_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO normal_web;`);
  limiter = new Pool({ ...connection, user: 'limiter_web', max: 8,
    options: '-c role=pracujbe_rate_limit -c statement_timeout=10000' });
  domain = new Pool({ ...connection, user: 'normal_web', max: 1 });
});

afterAll(async () => {
  try { await Promise.all([limiter?.end(), domain?.end()]); }
  finally {
    try { await admin?.end(); }
    finally {
      if (created) {
        let removed = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { docker('rm', '--force', container); } catch { /* weryfikujemy wynik */ }
          if (!docker('ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}')) { removed = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!removed) throw new Error('Nie udało się usunąć własnego kontenera testowego.');
      }
    }
  }
});

describe('Limiter PostgreSQL — atomowość i wąska rola', () => {
  it('przy 20 równoległych próbach przepuszcza dokładnie limit 5 i zapisuje także odmowy', async () => {
    const input = options({ max: 5 });
    const decisions = await Promise.all(Array.from({ length: 20 }, () => checkDatabaseRateLimit(limiter!, input)));
    expect(decisions.filter(Boolean)).toHaveLength(5);
    expect((await admin!.query('SELECT count FROM public.rate_limits')).rows).toEqual([{ count: 20 }]);
  });

  it('po wygaśnięciu okna resetuje licznik, a przedtem rozdziela akcje i identyfikatory', async () => {
    const input = options({ max: 1 });
    expect(await checkDatabaseRateLimit(limiter!, input)).toBe(true);
    expect(await checkDatabaseRateLimit(limiter!, input)).toBe(false);
    expect(await checkDatabaseRateLimit(limiter!, { ...input, action: 'register' })).toBe(true);
    expect(await checkDatabaseRateLimit(limiter!, { ...input, identifier: randomUUID() })).toBe(true);
    await admin!.query("UPDATE public.rate_limits SET window_start=now()-interval '61 seconds'");
    expect(await checkDatabaseRateLimit(limiter!, input)).toBe(true);
    expect(await checkDatabaseRateLimit(limiter!, input)).toBe(false);
  });

  it('zapisuje jedynie HMAC i normalizuje równoważne zapisy IPv6', async () => {
    const input = options({ max: 1, trustedClientIp: '2001:0db8:0:0:0:0:0:1', identifier: 'private-account' });
    expect(await checkDatabaseRateLimit(limiter!, input)).toBe(true);
    expect(await checkDatabaseRateLimit(limiter!, { ...input, trustedClientIp: '2001:db8::1' })).toBe(false);
    const rows = (await admin!.query('SELECT key FROM public.rate_limits')).rows;
    for (const row of rows) expect(row.key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(input.trustedClientIp);
    expect(JSON.stringify(rows)).not.toContain(input.identifier);
  });

  it('odmawia zwykłej puli, awarii RPC i zamkniętej puli; po przywróceniu działa', async () => {
    const input = options();
    expect(await checkDatabaseRateLimit(domain!, input)).toBe(false);
    await admin!.query('REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text,integer,integer) FROM pracujbe_rate_limit');
    try { expect(await checkDatabaseRateLimit(limiter!, input)).toBe(false); }
    finally { await admin!.query('GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text,integer,integer) TO pracujbe_rate_limit'); }
    expect(await checkDatabaseRateLimit(limiter!, input)).toBe(true);
    const closed = new Pool({ host: '127.0.0.1', port: 1, database: 'unused', user: 'unused' });
    await closed.end();
    expect(await checkDatabaseRateLimit(closed, input)).toBe(false);
  });

  it('nie daje roli limitera dostępu do danych auth, domeny, tabeli licznika ani eskalacji', async () => {
    for (const statement of ['SELECT * FROM auth.sessions', 'SELECT * FROM auth.accounts',
      'SELECT * FROM auth.verifications', 'UPDATE auth.users SET name=name', 'DELETE FROM auth.sessions',
      'SELECT * FROM public.profiles', 'UPDATE public.profiles SET first_name=first_name',
      "INSERT INTO public.companies(name,slug) VALUES ('obca firma','obca-firma')",
      'SELECT * FROM public.rate_limits', 'DELETE FROM public.rate_limits',
      "SELECT public.create_company_with_owner('obca firma','obca-firma')",
      'SET ROLE service_role', 'SET ROLE authenticated', 'SET ROLE postgres']) {
      await expect(limiter!.query(statement)).rejects.toMatchObject({ code: '42501' });
    }
    const functions = await admin!.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.prosecdef AND n.nspname IN ('public','auth')
      AND has_function_privilege('pracujbe_rate_limit', p.oid, 'EXECUTE') ORDER BY p.proname`);
    expect(functions.rows).toEqual([{ proname: 'rate_limit_hit' }]);
  });

  it('zachowuje rzeczywiste wywołania anon/authenticated po odebraniu PUBLIC EXECUTE', async () => {
    expect(await withUserTransaction(domain!, null, async (transaction) => {
      return await transaction.query('SELECT * FROM public.get_public_job($1,$2)', ['missing-job', 'pl']);
    })).toMatchObject({ rows: [] });
    const id = randomUUID();
    await admin!.query(`INSERT INTO auth.users(id,email,name,raw_user_meta_data)
      VALUES ($1,$2,'Fixture domeny','{"role":"employer","locale":"pl"}')`, [id, `${id}@example.invalid`]);
    expect(await withUserTransaction(domain!, id, async (transaction) => {
      return await transaction.query('SELECT public.current_profile_role() AS role');
    })).toMatchObject({ rows: [{ role: 'employer' }] });
  });

  it('przechodzi cały istniejący zestaw RLS po migracjach domenowych i auth', () => {
    // psql czyta zestaw ze stdin, więc \ir nie ma katalogu bazowego — strażnik roli
    // (role-assert.sql) wstawiamy w miejsce dyrektywy, bez zmiany samych asercji.
    const guard = readFileSync(new URL('../../supabase/tests/role-assert.sql', import.meta.url), 'utf8');
    const suite = readFileSync(new URL('../../supabase/tests/rls.sql', import.meta.url), 'utf8');
    expect(suite).toContain('\\ir role-assert.sql');
    const input = `BEGIN;\n${suite.replace('\\ir role-assert.sql', () => guard)}\nROLLBACK;`;
    const args = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'limiter_test'];
    const windows = process.platform === 'win32';
    const output = execFileSync(windows ? 'wsl.exe' : 'docker',
      windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
      { input, encoding: 'utf8', timeout: 60_000 });
    expect(output).toContain('ALL RLS TESTS PASSED');
  }, 70_000);

  it.each([{ max: 0 }, { windowSeconds: 0 }, { max: 1.5 }, { keySecret: '' }, { keySecret: 'x'.repeat(31) },
    { trustedClientIp: 'unknown' }, { action: 'client:controlled' }])('odrzuca błędne parametry %j', async (invalid) => {
      expect(await checkDatabaseRateLimit(limiter!, options(invalid))).toBe(false);
    });
});
