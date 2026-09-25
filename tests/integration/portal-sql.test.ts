import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execute, jsonArg, queryCount, queryOne, queryRows, rpc, rpcRows } from '../../src/lib/db/sql';
import { withServiceTransaction } from '../../src/lib/db/service';
import { withUserTransaction } from '../../src/lib/db/transaction';
import { startPortalDb, type PortalDb } from './support/portal-db';

// #25: helpery zapytań na rzeczywistym PostgreSQL 16 i loginach runtime jak w produkcji.
let db: PortalDb;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await startPortalDb();
  alice = await db.createUser('candidate', 'fr');
  bob = await db.createUser('candidate', 'nl');
  await db.admin.query(`CREATE FUNCTION public.it_echo(p_items jsonb, p_ids uuid[] DEFAULT NULL, p_n integer DEFAULT 7)
    RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('items', p_items, 'ids', p_ids, 'n', p_n) $$;
    GRANT EXECUTE ON FUNCTION public.it_echo(jsonb, uuid[], integer) TO authenticated;
    CREATE FUNCTION public.it_void() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    GRANT EXECUTE ON FUNCTION public.it_void() TO authenticated;`);
});

afterAll(async () => { await db?.stop(); });

describe('helpery SQL warstwy danych (#25)', () => {
  it('queryRows/queryOne zwracają JSON jak PostgREST: ISO z mikrosekundami, liczby, kolejność', async () => {
    const rows = await withUserTransaction(db.web, alice, (tx) => queryRows<{ n: number; at: string; big: number }>(tx, 'it.series',
      `SELECT g AS n, timestamptz '2026-01-02 03:04:05.123456+00' AS at, (g * 10)::bigint AS big
       FROM generate_series(3, 1, -1) g ORDER BY g DESC`));
    expect(rows.map((r) => r.n)).toEqual([3, 2, 1]);
    expect(rows[0]!.at).toBe('2026-01-02T03:04:05.123456+00:00');
    expect(rows[0]!.big).toBe(30);
    const none = await withUserTransaction(db.web, alice, (tx) => queryOne(tx, 'it.none', 'SELECT 1 WHERE false'));
    expect(none).toBeNull();
    await expect(withUserTransaction(db.web, alice, (tx) => queryOne(tx, 'it.many', 'SELECT generate_series(1,2) AS n')))
      .rejects.toThrow();
  });

  it('RLS: własny profil widoczny, cudzy nie; gość nie widzi żadnego', async () => {
    const own = await withUserTransaction(db.web, alice, (tx) =>
      queryRows<{ id: string }>(tx, 'it.profiles', 'SELECT id FROM public.profiles WHERE id = ANY($1::uuid[])', [[alice, bob]]));
    expect(own.map((r) => r.id)).toEqual([alice]);
    expect(await withUserTransaction(db.web, null, (tx) =>
      queryCount(tx, 'it.profiles-anon', 'SELECT 1 FROM public.profiles'))).toBe(0);
  });

  it('rpc: nazwane argumenty, jsonArg dla jsonb, tablice PG, pominięty = domyślny, void = null', async () => {
    const value = await withUserTransaction(db.web, alice, (tx) =>
      rpc<{ items: unknown; ids: string[]; n: number }>(tx, 'it_echo', { p_items: jsonArg(['a', { b: 1 }]), p_ids: [alice], p_n: undefined }));
    expect(value).toEqual({ items: ['a', { b: 1 }], ids: [alice], n: 7 });
    expect(await withUserTransaction(db.web, alice, (tx) => rpc(tx, 'it_void'))).toBeNull();
    const rows = await withUserTransaction(db.web, alice, (tx) =>
      rpcRows<{ code: string }>(tx, 'get_public_jobs', { p_locale: 'pl', p_limit: 5 }));
    expect(Array.isArray(rows)).toBe(true);
  });

  it('błąd bazy przerywa transakcję i trafia do wywołującego z kodem SQLSTATE', async () => {
    const error = await withUserTransaction(db.web, alice, (tx) =>
      execute(tx, 'it.denied', 'DELETE FROM public.applications')).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('42501');
  });

  it('pula service działa jako service_role bez tożsamości użytkownika; web nie przełączy się na service_role', async () => {
    const row = await withServiceTransaction(db.service, (tx) =>
      queryOne<{ role: string; uid: string | null; n: number }>(tx, 'it.service',
        'SELECT current_user::text AS role, auth.uid() AS uid, (SELECT count(*) FROM public.profiles)::int AS n'));
    expect(row).toEqual({ role: 'service_role', uid: null, n: 2 });
    await expect(db.web.query('SET ROLE service_role')).rejects.toThrow();
  });

  it('nazwy zapytań i funkcji są stałymi identyfikatorami (bez wstrzyknięcia)', async () => {
    await expect(withUserTransaction(db.web, alice, (tx) => rpc(tx, 'it_echo(); DROP TABLE x; --')))
      .rejects.toThrow('Nieprawidłowa nazwa funkcji.');
    await expect(withUserTransaction(db.web, alice, (tx) => rpc(tx, 'it_echo', { 'p_items => 1); --': 1 })))
      .rejects.toThrow('Nieprawidłowa nazwa argumentu.');
  });
});

describe('pula service odrzuca login o zbyt szerokich uprawnieniach (#25)', () => {
  it.each([
    ['z dodatkowym członkostwem pracujbe_app', 'GRANT service_role, pracujbe_app TO {login}'],
    ['z BYPASSRLS na loginie', 'GRANT service_role TO {login}; ALTER ROLE {login} BYPASSRLS'],
    ['bez członkostwa service_role', 'GRANT pracujbe_app TO {login}'],
  ])('%s', async (_label, grants) => {
    const login = `it_bad_${Math.random().toString(16).slice(2, 10)}`;
    await db.admin.query(`CREATE ROLE ${login} LOGIN PASSWORD 'bad-login-password-0123456789abcdef'
      NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE; ${grants.replaceAll('{login}', login)}`);
    const url = new URL((db.admin.options as { connectionString: string }).connectionString);
    url.username = login;
    url.password = 'bad-login-password-0123456789abcdef';
    const { createRuntimePool } = await import('../../src/lib/db/pool');
    await expect(createRuntimePool(url.toString(), 'service')).rejects.toThrow('Nie można uruchomić');
    await db.admin.query(`DROP ROLE ${login}`);
  });
});

describe('attempt: niezależne sekcje w jednej transakcji (#25)', () => {
  it('błąd sekcji nie przerywa transakcji; kolejne sekcje i COMMIT działają', async () => {
    const { attempt } = await import('../../src/lib/db/sql');
    const result = await withUserTransaction(db.web, alice, async (tx) => {
      const bad = await attempt(tx, () => queryRows(tx, 'it.bad', 'SELECT 1/0 AS x'));
      const good = await attempt(tx, () => queryCount(tx, 'it.good', 'SELECT 1 FROM public.profiles WHERE id = $1', [alice]));
      return { bad, good };
    });
    expect(result.bad.ok).toBe(false);
    expect((result.bad as { error: { code?: string } }).error.code).toBe('22012');
    expect(result.good).toEqual({ ok: true, value: 1 });
  });
});
