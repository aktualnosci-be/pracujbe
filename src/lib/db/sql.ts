import 'server-only';

import type { TransactionQuery } from './transaction';

/**
 * Zapytania warstwy danych (#25) na transakcji z `withUserTransaction`/`withServiceTransaction`.
 *
 * Wynik budujemy w PostgreSQL przez `json_agg`/`to_json` — tak samo jak PostgREST — więc
 * znaczniki czasu wracają jako ISO 8601 z pełną precyzją (kursory stronicowania),
 * `bigint`/`numeric` jako liczby JSON, a `jsonb` jako obiekty. Kształt danych loaderów
 * pozostaje taki jak przy kliencie Supabase.
 *
 * Każde zapytanie ma stałą nazwę (`/* kind:name *\/` na początku tekstu): ułatwia diagnostykę
 * i pozwala testom jednostkowym podstawić wynik bez parsowania SQL. Nazwy i nazwy funkcji
 * pochodzą wyłącznie ze stałych w kodzie — wartości zawsze trafiają do parametrów `$n`.
 */

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number | null };

const QUERY_NAME = /^[a-z][a-z0-9_.-]{0,95}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/** Rodzaj zapytania zapisany w komentarzu — czytają go testowe atrapy transakcji. */
export type QueryKind = 'rows' | 'one' | 'count' | 'exec' | 'rpc' | 'rpcrows';

function tag(kind: QueryKind, name: string): string {
  if (!QUERY_NAME.test(name) && !(kind.startsWith('rpc') && IDENTIFIER.test(name))) {
    throw new Error('Nieprawidłowa nazwa zapytania.');
  }
  return `/* ${kind}:${name} */ `;
}

async function run(tx: TransactionQuery, text: string, values: unknown[]): Promise<QueryResult> {
  return (await tx.query(text, values)) as QueryResult;
}

/** Wiersze zapytania SELECT jako obiekty JSON (kolejność z ORDER BY zapytania). */
export async function queryRows<T = Record<string, unknown>>(
  tx: TransactionQuery,
  name: string,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await run(
    tx,
    `${tag('rows', name)}SELECT coalesce(json_agg(q), '[]'::json) AS v FROM (${text}) q`,
    values,
  );
  const rows = result.rows[0]?.['v'];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Najwyżej jeden wiersz (odpowiednik `maybeSingle()`): brak = null, więcej niż jeden = błąd,
 * bo oznacza niejednoznaczny filtr — nie wybieramy losowego wiersza.
 */
export async function queryOne<T = Record<string, unknown>>(
  tx: TransactionQuery,
  name: string,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await run(
    tx,
    `${tag('one', name)}SELECT coalesce(json_agg(q), '[]'::json) AS v FROM (${text}) q`,
    values,
  );
  const rows = result.rows[0]?.['v'];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (rows.length > 1) throw new Error('Zapytanie zwróciło więcej niż jeden wiersz.');
  return rows[0] as T;
}

/** Liczba wierszy zapytania (odpowiednik `count: 'exact', head: true`). */
export async function queryCount(
  tx: TransactionQuery,
  name: string,
  text: string,
  values: unknown[] = [],
): Promise<number> {
  const result = await run(tx, `${tag('count', name)}SELECT count(*)::integer AS n FROM (${text}) q`, values);
  const count = Number(result.rows[0]?.['n'] ?? 0);
  return Number.isFinite(count) ? count : 0;
}

/**
 * Polecenie modyfikujące (INSERT/UPDATE/DELETE, zwykle pod RLS). Zwraca liczbę wierszy
 * i surowe wiersze z RETURNING (kolumny proste: id, statusy).
 */
export async function execute(
  tx: TransactionQuery,
  name: string,
  text: string,
  values: unknown[] = [],
): Promise<{ rowCount: number; rows: Record<string, unknown>[] }> {
  const result = await run(tx, `${tag('exec', name)}${text}`, values);
  return { rowCount: result.rowCount ?? result.rows.length, rows: result.rows };
}

/** Argument RPC typu json/jsonb: tablica/obiekt wysyłane jako JSON, nie literał tablicy PG. */
export class JsonArg {
  constructor(readonly value: unknown) {}
}

export function jsonArg(value: unknown): JsonArg {
  return new JsonArg(value);
}

export type RpcArgs = Record<string, unknown>;

function rpcCall(fn: string, args: RpcArgs): { call: string; values: unknown[] } {
  if (!IDENTIFIER.test(fn)) throw new Error('Nieprawidłowa nazwa funkcji.');
  const values: unknown[] = [];
  const named: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    // Jak w PostgREST: pominięty (undefined) argument = wartość domyślna funkcji.
    if (value === undefined) continue;
    if (!IDENTIFIER.test(key)) throw new Error('Nieprawidłowa nazwa argumentu.');
    values.push(value instanceof JsonArg ? JSON.stringify(value.value ?? null) : value);
    named.push(`${key} => $${values.length}`);
  }
  return { call: `public.${fn}(${named.join(', ')})`, values };
}

/**
 * Wywołanie funkcji SQL zwracającej wartość skalarną, jsonb albo pojedynczy rekord
 * (odpowiednik `supabase.rpc()` dla takich funkcji). Funkcja `void` zwraca null.
 */
export async function rpc<T = unknown>(
  tx: TransactionQuery,
  fn: string,
  args: RpcArgs = {},
): Promise<T | null> {
  const { call, values } = rpcCall(fn, args);
  const result = await run(tx, `${tag('rpc', fn)}SELECT to_json(t) AS v FROM ${call} t`, values);
  return (result.rows[0]?.['v'] ?? null) as T | null;
}

/** Wywołanie funkcji zwracającej zbiór (SETOF/TABLE) — zawsze tablica. */
export async function rpcRows<T = Record<string, unknown>>(
  tx: TransactionQuery,
  fn: string,
  args: RpcArgs = {},
): Promise<T[]> {
  const { call, values } = rpcCall(fn, args);
  const result = await run(
    tx,
    `${tag('rpcrows', fn)}SELECT coalesce(json_agg(t), '[]'::json) AS v FROM ${call} t`,
    values,
  );
  const rows = result.rows[0]?.['v'];
  return Array.isArray(rows) ? (rows as T[]) : [];
}
