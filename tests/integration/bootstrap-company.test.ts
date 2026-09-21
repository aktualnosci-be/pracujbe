import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCompany } from '../../src/lib/auth/bootstrap-company';
import { withUserTransaction } from '../../src/lib/db/transaction';

interface Result { rows: Record<string, unknown>[] }
interface Client {
  query(sql: string, values?: unknown[]): Promise<Result>;
  release(destroy?: boolean): void;
}
interface Pool {
  connect(): Promise<Client>;
  query(sql: string, values?: unknown[]): Promise<Result>;
  end(): Promise<void>;
}
const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: Record<string, unknown>) => Pool;
};
const container = `pracujbe-company-test-${randomUUID()}`;
const password = randomUUID();
const appName = `bootstrap-test-${randomUUID()}`;
let created = false;
let admin: Pool | undefined;
let app: Pool | undefined;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

async function createUser(role = 'employer'): Promise<string> {
  const id = randomUUID();
  await admin!.query(`INSERT INTO auth.users(id,email,name,raw_user_meta_data)
    VALUES ($1,$2,'Test',$3::jsonb)`, [id, `${id}@example.invalid`, JSON.stringify({ role, locale: 'pl' })]);
  return id;
}

async function memberships(id: string): Promise<Record<string, unknown>[]> {
  return (await admin!.query('SELECT company_id, role, is_active FROM public.company_members WHERE profile_id=$1', [id])).rows;
}

beforeAll(async () => {
  // Własny klaster i jawne parametry; nigdy DATABASE_URL ani port współdzielonej bazy.
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=company_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const connection = { host: '127.0.0.1', port, database: 'company_test', password, connectionTimeoutMillis: 10_000 };
  admin = new PgPool({ ...connection, user: 'postgres', max: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  await admin.query(readFileSync(new URL('../../database/bootstrap/0001_roles_and_identity.sql', import.meta.url), 'utf8'));
  // Rzeczywiste polityki RLS, strażniki ownera i RPC, bez ich testowych zamienników.
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  await admin.query('BEGIN');
  for (const filename of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(new URL(filename, migrations), 'utf8'));
  }
  await admin.query(readFileSync(new URL('../../database/auth/0057_better_auth_core.sql', import.meta.url), 'utf8'));
  await admin.query('COMMIT');
  await admin.query(`CREATE ROLE bootstrap_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO bootstrap_web;
    CREATE FUNCTION public.test_company_gate() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name = 'Firma równoległa' THEN PERFORM pg_advisory_xact_lock(724031, 91); END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_company_gate BEFORE INSERT ON public.companies
      FOR EACH ROW EXECUTE FUNCTION public.test_company_gate();
    CREATE FUNCTION public.test_member_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.companies WHERE id=NEW.company_id AND name='Firma z awarią')
      THEN RAISE EXCEPTION 'kontrolowana awaria członkostwa'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_member_failure BEFORE INSERT ON public.company_members
      FOR EACH ROW EXECUTE FUNCTION public.test_member_failure();`);
  app = new PgPool({ ...connection, user: 'bootstrap_web', max: 4, application_name: appName,
    options: '-c statement_timeout=30000 -c lock_timeout=25000' });
});

afterAll(async () => {
  try { await app?.end(); }
  finally {
    try { await admin?.end(); }
    finally {
      if (created) {
        // WSL/Docker może chwilowo odrzucić wywołanie. Ponawiamy tylko własną
        // losową nazwę i sprawdzamy zniknięcie kontenera, nigdy całej puli hosta.
        for (let attempt = 0; attempt < 3; attempt++) {
          try { docker('rm', '--force', container); } catch { /* weryfikacja poniżej */ }
          if (!docker('ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}')) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Nie udało się usunąć własnego kontenera testowego.');
      }
    }
  }
});

describe('Bootstrap firmy — rzeczywisty PostgreSQL 16', () => {
  it('serializuje dwa wywołania: jedna firma, jeden owner i ta sama odpowiedź', async () => {
    const id = await createUser();
    // Oba rzeczywiste połączenia są gotowe PRZED startem wyścigu. Bariera
    // nie mierzy czasu na uruchomienie drugiego połączenia pod obciążeniem CI.
    const first = await app!.connect();
    let second: Client;
    try { second = await app!.connect(); }
    catch (error) { first.release(); throw error; }
    const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
    expect(firstPid).not.toBe(secondPid);
    // Helper dostaje prawdziwe zapytania; zarezerwowane klienty oddaje test.
    const reserved = (client: Client) => ({ connect: async () => ({
      query: (sql: string, values?: unknown[]) => client.query(sql, values),
      release: () => {},
    }) });
    await admin!.query('SELECT pg_advisory_lock(724031, 91)');
    const calls = [bootstrapCompany(reserved(first), id, 'Firma równoległa'), bootstrapCompany(reserved(second), id, 'Firma równoległa')];
    // Podpinamy obsługę odrzuceń od razu, także gdy kontrola blokad obleje.
    const results = Promise.allSettled(calls);
    let blocked = 0;
    try {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const activity = await admin!.query(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid = ANY($1::int[]) AND wait_event_type='Lock'
            AND cardinality(pg_blocking_pids(pid)) > 0`, [[firstPid, secondPid]]);
        blocked = Number(activity.rows[0]?.count);
        if (blocked === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      try { await admin!.query('SELECT pg_advisory_unlock(724031, 91)'); }
      finally {
        await results;
        first.release();
        second.release();
      }
    }
    const settled = await results;
    expect(blocked).toBe(2);
    expect(settled.every((result) => result.status === 'fulfilled')).toBe(true);
    const completed = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const companies = await admin!.query("SELECT count(*)::int AS count FROM public.companies WHERE name='Firma równoległa'");
    expect(companies.rows[0]?.count).toBe(1);
    expect(completed.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(completed.map((result) => result.companyId)).size).toBe(1);
    expect(await memberships(id)).toEqual([{ company_id: completed[0]!.companyId, role: 'owner', is_active: true }]);
  }, 40_000);

  it('nie tworzy zastępczej firmy przy nieaktywnym członkostwie', async () => {
    const id = await createUser();
    const first = await bootstrapCompany(app!, id, 'Pierwsza firma');
    await admin!.query('UPDATE public.company_members SET is_active=false WHERE profile_id=$1', [id]);
    expect(await bootstrapCompany(app!, id, 'Zastępcza firma')).toEqual({ companyId: first.companyId, created: false });
    expect(await memberships(id)).toHaveLength(1);
  });

  it.each(['candidate', 'inactive', 'deleted', 'missing'])('odrzuca profil %s', async (state) => {
    const id = state === 'missing' ? randomUUID() : await createUser(state === 'candidate' ? 'candidate' : 'employer');
    if (state === 'inactive') await admin!.query('UPDATE public.profiles SET is_active=false WHERE id=$1', [id]);
    if (state === 'deleted') await admin!.query('UPDATE public.profiles SET deleted_at=now() WHERE id=$1', [id]);
    await expect(bootstrapCompany(app!, id, 'Niedozwolona firma')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await memberships(id)).toHaveLength(0);
  });

  it('po błędzie członkostwa wycofuje firmę, zwalnia blokadę i pozwala ponowić bootstrap', async () => {
    const id = await createUser();
    await expect(bootstrapCompany(app!, id, 'Firma z awarią')).rejects.toThrow('kontrolowana awaria członkostwa');
    expect(await memberships(id)).toHaveLength(0);
    expect((await admin!.query("SELECT id FROM public.companies WHERE name='Firma z awarią'")).rows).toHaveLength(0);
    expect(await bootstrapCompany(app!, id, 'Firma po ponowieniu')).toMatchObject({ created: true });
    expect(await memberships(id)).toHaveLength(1);
  });

  it('pozostawia możliwość świadomego posiadania wielu firm poza bootstrapem', async () => {
    const id = await createUser();
    await bootstrapCompany(app!, id, 'Firma automatyczna');
    await withUserTransaction(app!, id, (transaction) => transaction.query(
      'SELECT public.create_company_with_owner($1,$2)', ['Firma świadoma', `firma-${randomUUID()}`],
    ));
    expect(await memberships(id)).toHaveLength(2);
    expect(await bootstrapCompany(app!, id, 'Trzecia automatyczna')).toMatchObject({ created: false });
    expect(await memberships(id)).toHaveLength(2);
  });
});
