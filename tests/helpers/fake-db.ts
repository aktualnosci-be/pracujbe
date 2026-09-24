/**
 * Atrapa transakcji warstwy danych (#25) dla testów jednostkowych.
 *
 * Helpery `src/lib/db/sql.ts` zapisują rodzaj i nazwę zapytania w komentarzu
 * (`/* rows:employer.jobs *\/`, `/* rpc:apply_to_job *\/`). Atrapa rozpoznaje je
 * i zwraca wynik z zarejestrowanego handlera w kształcie, jaki zwróciłby PostgreSQL.
 * Argumenty RPC są odtwarzane po nazwach (`p_x => $1`), więc testy sprawdzają
 * dokładnie to, co trafiłoby do funkcji SQL. SQL zapytań sprawdzają testy integracyjne.
 *
 * Handler:
 * - rows/one → tablica wierszy; count → liczba; exec → { rowCount, rows } albo liczba;
 * - rpc → wartość; rpcrows → tablica;
 * - rzucenie wyjątku = błąd bazy (np. `pgError('P0001', 'VALIDATION_FAILED')`).
 * Nieznane zapytanie = błąd testu (nie cichy pusty wynik).
 */
import type { PortalIdentity } from '@/lib/auth/session';

type Kind = 'rows' | 'one' | 'count' | 'exec' | 'rpc' | 'rpcrows';

export interface FakeCall {
  kind: Kind;
  name: string;
  /** Argumenty RPC po nazwach albo wartości parametrów zapytania ($1…). */
  args: Record<string, unknown>;
  values: unknown[];
  text: string;
  /** Tożsamość transakcji (null = gość, 'service' = service_role). */
  as: string | null;
}

export type FakeHandler = (input: { args: Record<string, unknown>; values: unknown[]; text: string }) => unknown;

export interface PgLikeError extends Error {
  code: string;
}

/** Błąd bazy w kształcie pg.DatabaseError (message + code). */
export function pgError(code: string, message: string): PgLikeError {
  const error = new Error(message) as PgLikeError;
  error.code = code;
  return error;
}

function parse(text: string, values: unknown[]): { kind: Kind; name: string; args: Record<string, unknown> } {
  const match = /^\/\* (rows|one|count|exec|rpc|rpcrows):([a-z0-9_.-]+) \*\//.exec(text);
  if (!match) throw new Error(`Atrapa DB: zapytanie bez nazwy: ${text.slice(0, 80)}`);
  const kind = match[1] as Kind;
  const name = match[2]!;
  const args: Record<string, unknown> = {};
  if (kind === 'rpc' || kind === 'rpcrows') {
    for (const arg of text.matchAll(/([a-z_][a-z0-9_]*) => \$(\d+)/g)) {
      const raw = values[Number(arg[2]) - 1];
      args[arg[1]!] = raw;
    }
  }
  return { kind, name, args };
}

export function createFakeDb() {
  const handlers = new Map<string, FakeHandler>();
  const calls: FakeCall[] = [];

  function key(kind: Kind, name: string) {
    // rows i one współdzielą handler — test nie musi wiedzieć, której formy użyto.
    return `${kind === 'one' ? 'rows' : kind === 'rpcrows' ? 'rpc' : kind}:${name}`;
  }

  function txFor(as: string | null) {
    return {
      query: async (text: string, values: unknown[] = []) => {
        const { kind, name, args } = parse(text, values);
        calls.push({ kind, name, args, values, text, as });
        const handler = handlers.get(key(kind, name));
        if (!handler) throw new Error(`Atrapa DB: brak handlera dla ${kind}:${name}`);
        const result = await handler({ args, values, text });
        switch (kind) {
          case 'rows':
          case 'one':
          case 'rpcrows':
            return { rows: [{ v: result ?? [] }] };
          case 'count':
            return { rows: [{ n: result ?? 0 }] };
          case 'rpc':
            return { rows: result === undefined ? [] : [{ v: result }] };
          case 'exec': {
            if (typeof result === 'number') return { rowCount: result, rows: [] };
            const r = (result ?? {}) as { rowCount?: number; rows?: unknown[] };
            return { rowCount: r.rowCount ?? r.rows?.length ?? 0, rows: r.rows ?? [] };
          }
        }
      },
    };
  }

  const api = {
    calls,
    /** Rejestruje wynik zapytania tabelowego (rows/one). */
    rows(name: string, handler: FakeHandler | unknown[]) {
      handlers.set(`rows:${name}`, typeof handler === 'function' ? (handler as FakeHandler) : () => handler);
      return api;
    },
    count(name: string, handler: FakeHandler | number) {
      handlers.set(`count:${name}`, typeof handler === 'function' ? (handler as FakeHandler) : () => handler);
      return api;
    },
    exec(name: string, handler: FakeHandler | number = 1) {
      handlers.set(`exec:${name}`, typeof handler === 'function' ? (handler as FakeHandler) : () => handler);
      return api;
    },
    /** Rejestruje wynik RPC (rpc i rpcRows). Handler dostaje argumenty po nazwach. */
    rpc(fn: string, handler: FakeHandler | unknown) {
      handlers.set(`rpc:${fn}`, typeof handler === 'function' ? (handler as FakeHandler) : () => handler);
      return api;
    },
    /** Wszystkie wywołania o danej nazwie (RPC albo zapytania). */
    callsTo(name: string) {
      return calls.filter((call) => call.name === name);
    },
    txFor,
  };
  return api;
}

export type FakeDb = ReturnType<typeof createFakeDb>;

/**
 * Implementacja modułu `@/lib/db/portal` na atrapie. Użycie:
 *
 *   const db = createFakeDb();
 *   const session = { identity: { id: USER, role: 'candidate' } as PortalIdentity | null };
 *   vi.mock('@/lib/db/portal', () => fakePortalModule(db, session));
 *
 * (`vi.hoisted` dla `db`/`session`, bo `vi.mock` jest wynoszone na początek pliku.)
 */
export function fakePortalModule(
  db: FakeDb,
  session: { identity: PortalIdentity | null; configured?: boolean; serviceConfigured?: boolean },
) {
  return {
    isPortalDataConfigured: () => session.configured ?? true,
    isServiceDatabaseConfigured: () => session.serviceConfigured ?? true,
    getPortalIdentity: async () => session.identity,
    withPortalTransaction: async <T>(identity: PortalIdentity | null, action: (tx: ReturnType<FakeDb['txFor']>) => Promise<T>) =>
      action(db.txFor(identity?.id ?? null)),
    withServiceRole: async <T>(action: (tx: ReturnType<FakeDb['txFor']>) => Promise<T>) => action(db.txFor('service')),
  };
}

/**
 * Wspólna atrapa pliku testowego (vitest izoluje moduły per plik):
 *
 *   import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';
 *   vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
 *   beforeEach(() => resetFakeDb({ id: USER, role: 'candidate' }));
 */
export let fakeDb = createFakeDb();
export const fakeSession: { identity: PortalIdentity | null; configured?: boolean; serviceConfigured?: boolean } = {
  identity: null,
};

export function resetFakeDb(identity: PortalIdentity | null = null) {
  fakeDb = createFakeDb();
  fakeSession.identity = identity;
  fakeSession.configured = true;
  fakeSession.serviceConfigured = true;
  return fakeDb;
}

/** Moduł `@/lib/db/portal` czytający bieżące `fakeDb`/`fakeSession` przy każdym wywołaniu. */
export function fakePortal() {
  return {
    isPortalDataConfigured: () => fakeSession.configured ?? true,
    isServiceDatabaseConfigured: () => fakeSession.serviceConfigured ?? true,
    getPortalIdentity: async () => fakeSession.identity,
    withPortalTransaction: async <T>(identity: PortalIdentity | null, action: (tx: ReturnType<FakeDb['txFor']>) => Promise<T>) =>
      action(fakeDb.txFor(identity?.id ?? null)),
    withServiceRole: async <T>(action: (tx: ReturnType<FakeDb['txFor']>) => Promise<T>) => action(fakeDb.txFor('service')),
  };
}
