import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserTransaction, type TransactionQuery } from '../../src/lib/db/transaction';

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
// Rzeczywisty sterownik pg; kontrakt lokalny nie wymaga zależności @types/pg.
const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: Record<string, unknown>) => Pool;
};
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const container = `pracujbe-transaction-test-${randomUUID()}`;
const password = randomUUID();
let created = false;
let admin: Pool | undefined;
let app: Pool | undefined;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

async function inspect(transaction: TransactionQuery): Promise<Record<string, unknown>> {
  const result = await transaction.query(`SELECT pg_backend_pid() AS pid,
    current_user AS role, session_user AS login, auth.uid() AS uid,
    (SELECT array_agg(owner_id::text ORDER BY owner_id) FROM public.transaction_probe) AS owners`);
  return (result as Result).rows[0]!;
}

beforeAll(async () => {
  // Nigdy nie czytamy DATABASE_URL: ten test nie może dotknąć współdzielonej bazy.
  docker('run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=transaction_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  const connection = { host: '127.0.0.1', port, database: 'transaction_test', password,
    max: 1, connectionTimeoutMillis: 2_000 };
  admin = new PgPool({ ...connection, user: 'postgres' });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  await admin.query(readFileSync(new URL('../../database/bootstrap/0001_roles_and_identity.sql', import.meta.url), 'utf8'));
  await admin.query(`CREATE ROLE transaction_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO transaction_web;
    CREATE TABLE public.transaction_probe (owner_id uuid PRIMARY KEY, note text NOT NULL);
    ALTER TABLE public.transaction_probe ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON public.transaction_probe FOR ALL TO authenticated
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());`);
  await admin.query('INSERT INTO public.transaction_probe VALUES ($1,$3),($2,$3)', [alice, bob, 'original']);
  app = new PgPool({ ...connection, user: 'transaction_web' });
});

afterAll(async () => {
  try { await app?.end(); }
  finally {
    try { await admin?.end(); }
    finally { if (created) docker('rm', '--force', container); }
  }
});

describe('withUserTransaction — prawdziwy PostgreSQL 16 i ograniczony login', () => {
  it('ponownie używa jednej sesji A → B → gość bez przenoszenia tożsamości ani roli', async () => {
    const a = await withUserTransaction(app!, alice, inspect);
    const b = await withUserTransaction(app!, bob, inspect);
    const guest = await withUserTransaction(app!, null, inspect);
    expect(a).toMatchObject({ role: 'authenticated', login: 'transaction_web', uid: alice, owners: [alice] });
    expect(b).toMatchObject({ role: 'authenticated', login: 'transaction_web', uid: bob, owners: [bob] });
    expect(guest).toMatchObject({ role: 'anon', login: 'transaction_web', uid: null, owners: null });
    expect(b.pid).toBe(a.pid);
    expect(guest.pid).toBe(a.pid);
    const outside = await app!.query("SELECT pg_backend_pid() AS pid, current_user AS role, nullif(current_setting('app.current_uid', true), '') AS uid");
    expect(outside.rows[0]).toEqual({ pid: a.pid, role: 'transaction_web', uid: null });
  });

  it('cofa rzeczywisty zapis i czyści kontekst po wyjątku callbacka', async () => {
    let failedPid: unknown;
    await expect(withUserTransaction(app!, alice, async (transaction) => {
      failedPid = (await inspect(transaction)).pid;
      await transaction.query('UPDATE public.transaction_probe SET note=$1 WHERE owner_id=$2', ['changed', alice]);
      throw new Error('kontrolowana awaria');
    })).rejects.toThrow('kontrolowana awaria');
    const persisted = await admin!.query('SELECT note FROM public.transaction_probe WHERE owner_id=$1', [alice]);
    expect(persisted.rows[0]?.note).toBe('original');
    const outside = await app!.query("SELECT current_user AS role, nullif(current_setting('app.current_uid', true), '') AS uid");
    expect(outside.rows[0]).toEqual({ role: 'transaction_web', uid: null });
    const next = await withUserTransaction(app!, bob, inspect);
    expect(next).toMatchObject({ pid: failedPid, uid: bob, owners: [bob] });
    expect(await withUserTransaction(app!, null, inspect)).toMatchObject({ pid: failedPid, uid: null, owners: null });
  });

  it.each(['SET ROLE postgres', 'SET ROLE service_role', 'SET SESSION AUTHORIZATION postgres',
    'ALTER ROLE transaction_web SUPERUSER', 'ALTER ROLE transaction_web BYPASSRLS'])
    ('odrzuca eskalację rzeczywistego loginu: %s', async (statement) => {
      await expect(app!.query(statement)).rejects.toMatchObject({ code: '42501' });
      await expect(withUserTransaction(app!, alice, (transaction) => transaction.query(statement)))
        .rejects.toMatchObject({ code: '42501' });
      expect(await withUserTransaction(app!, bob, inspect)).toMatchObject({ role: 'authenticated', uid: bob, owners: [bob] });
    });
});
