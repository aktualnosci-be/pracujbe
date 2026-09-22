import 'server-only';

import type { GetJobsParams } from '../jobs';
import { withUserTransaction, type TransactionPool, type TransactionQuery } from './transaction';

export type PublicJobRow = Record<string, unknown>;

export interface PublicJobsResult {
  rows: PublicJobRow[];
  total: number;
  page: number;
  pageSize: number;
}

// To wyłącznie stałe nazwy argumentów RPC. Dane zawsze trafiają do parametrów
// zapytania; lista i licznik otrzymują ten sam komplet filtrów.
const FILTER_ARGUMENTS = `
  p_locale => $1::text,
  p_keyword => $2::text,
  p_city => $3::text,
  p_categories => $4::text[],
  p_locations => $5::text[],
  p_contract_types => $6::text[],
  p_salary_min => $7::integer,
  p_salary_max => $8::integer,
  p_accommodation => $9::boolean,
  p_immediate => $10::boolean,
  p_no_language => $11::boolean,
  p_since => $12::timestamptz`;

function locale(value: string): string {
  return ['pl', 'nl', 'fr', 'en'].includes(value) ? value : 'pl';
}

function filterValues(params: GetJobsParams): unknown[] {
  // Tablice mają pierwszeństwo przed pojedynczym filtrem, tak jak w lib/jobs.
  const categories = params.categories ?? (params.category ? [params.category] : null);
  const contracts = params.contractTypes ?? (params.contractType ? [params.contractType] : null);
  return [locale(params.locale), params.keyword ?? null, params.city ?? null,
    categories?.length ? categories : null,
    params.locations?.length ? params.locations : null,
    contracts?.length ? contracts : null,
    params.salaryMin ?? null, params.salaryMax ?? null, params.accommodation ?? null,
    params.immediate ?? null, params.noLanguageRequired ?? null, params.since ?? null];
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback : Math.min(maximum, Math.max(1, Math.trunc(value)));
}

async function readCount(transaction: TransactionQuery, values: unknown[]): Promise<number> {
  // pg zwraca bigint jako string, natomiast JSON zachowuje kontrakt dotychczasowego
  // RPC HTTP. Odrzucamy wynik poza bezpiecznym zakresem liczb JavaScript.
  const result = await transaction.query(
    `SELECT to_jsonb(public.get_public_jobs_count(${FILTER_ARGUMENTS})) AS total`, values,
  ) as { rows: { total: unknown }[] };
  const total = result.rows[0]?.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    throw new Error('Nieprawidłowy licznik publicznych ofert.');
  }
  return total;
}

/** Wyłącznie publiczne RPC pod anon, niezależnie od sesji osoby przeglądającej. */
export async function getPublicJobs(pool: TransactionPool, params: GetJobsParams): Promise<PublicJobsResult> {
  const page = positiveInteger(params.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positiveInteger(params.pageSize, 12, 100);
  const values = filterValues(params);
  return withUserTransaction(pool, null, async (transaction) => {
    // to_jsonb zachowuje daty jako tekst ISO oraz liczby/NULL/tablice, bez parserów
    // typów pg zmieniających timestamptz/date na obiekty Date w starej warstwie UI.
    const result = await transaction.query(`SELECT to_jsonb(job) AS job
      FROM public.get_public_jobs(${FILTER_ARGUMENTS},
        p_sort => $13::text, p_limit => $14::integer, p_offset => $15::integer) AS job`,
    [...values, params.sort ?? 'newest', pageSize, Math.min(10_000, (page - 1) * pageSize)],
    ) as { rows: { job: PublicJobRow }[] };
    const total = await readCount(transaction, values);
    return { rows: result.rows.map((row) => row.job), total, page, pageSize };
  });
}

export async function getPublicJobsCount(pool: TransactionPool, params: GetJobsParams): Promise<number> {
  return withUserTransaction(pool, null, (transaction) => readCount(transaction, filterValues(params)));
}

type FacetCountRow = { key: unknown; total: unknown };

function facetCounts(keys: readonly string[], rows: FacetCountRow[]): Record<string, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const row of rows) {
    if (
      typeof row.key !== 'string' ||
      !Object.hasOwn(counts, row.key) ||
      typeof row.total !== 'number' ||
      !Number.isSafeInteger(row.total) ||
      row.total < 0
    ) {
      throw new Error('Nieprawidłowy agregat publicznych ofert.');
    }
    counts[row.key] = row.total;
  }
  return counts;
}

/** Jeden grupowany odczyt dla całego zestawu kategorii, w publicznym zakresie listy ofert. */
export async function getPublicJobCategoryCounts(
  pool: TransactionPool,
  keys: readonly string[],
): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT key, to_jsonb(total) AS total
       FROM public.get_public_job_category_counts($1::text[])`,
      [keys],
    )) as { rows: FacetCountRow[] };
    return facetCounts(keys, result.rows);
  });
}

/** Jeden grupowany odczyt zachowujący semantykę filtra miasta (`ILIKE %wartość%`). */
export async function getPublicJobCityCounts(
  pool: TransactionPool,
  cities: readonly string[],
): Promise<Record<string, number>> {
  if (cities.length === 0) return {};
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT key, to_jsonb(total) AS total
       FROM public.get_public_job_city_counts($1::text[])`,
      [cities],
    )) as { rows: FacetCountRow[] };
    return facetCounts(cities, result.rows);
  });
}

export async function getPublicJob(pool: TransactionPool, slug: string, requestedLocale: string): Promise<PublicJobRow | null> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = await transaction.query(`SELECT to_jsonb(job) AS job
      FROM public.get_public_job(p_slug => $1::text, p_locale => $2::text) AS job`,
    [slug, locale(requestedLocale)],
    ) as { rows: { job: PublicJobRow }[] };
    return result.rows[0]?.job ?? null;
  });
}
