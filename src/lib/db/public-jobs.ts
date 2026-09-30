import 'server-only';

import type { GetJobsParams } from '../jobs';
import { isLocale, routing } from '@/i18n/routing';
import type { JobFilterFacets } from '@/types/job-filter-facets';
import {
  isJobListPageBeyondLimit,
  jobListLastPage,
  jobListNaturalOffset,
} from '@/lib/job-list-pagination';
import {
  withUserTransaction,
  type TransactionPool,
  type TransactionQuery,
} from './transaction';

export type PublicJobRow = Record<string, unknown>;

export interface PublicJobsResult {
  rows: PublicJobRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Ostatnia osiągalna strona (#593) — nigdy więcej niż `MAX_JOB_LIST_OFFSET` naturalnego
   *  offsetu; `total` zostaje dokładny nawet gdy przekracza tę granicę. */
  maxPage: number;
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
  p_since => $12::timestamptz,
  p_salary_unit => $13::text,
  p_direct_only => $14::boolean`;

function locale(value: string): string {
  return isLocale(value) ? value : routing.defaultLocale;
}

function filterValues(params: GetJobsParams): unknown[] {
  // Tablice mają pierwszeństwo przed pojedynczym filtrem, tak jak w lib/jobs.
  const categories =
    params.categories ?? (params.category ? [params.category] : null);
  const contracts =
    params.contractTypes ??
    (params.contractType ? [params.contractType] : null);
  return [
    locale(params.locale),
    params.keyword ?? null,
    params.city ?? null,
    categories?.length ? categories : null,
    params.locations?.length ? params.locations : null,
    contracts?.length ? contracts : null,
    params.salaryMin ?? null,
    params.salaryMax ?? null,
    params.accommodation ?? null,
    params.immediate ?? null,
    params.noLanguageRequired ?? null,
    params.since ?? null,
    params.salaryUnit ?? 'month',
    params.directOnly ? true : null,
  ];
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(maximum, Math.max(1, Math.trunc(value)));
}

async function readCount(
  transaction: TransactionQuery,
  values: unknown[],
): Promise<number> {
  // pg zwraca bigint jako string, natomiast JSON zachowuje kontrakt dotychczasowego
  // RPC HTTP. Odrzucamy wynik poza bezpiecznym zakresem liczb JavaScript.
  const result = (await transaction.query(
    `SELECT to_jsonb(public.get_public_jobs_count(${FILTER_ARGUMENTS})) AS total`,
    values,
  )) as { rows: { total: unknown }[] };
  const total = result.rows[0]?.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    throw new Error('Nieprawidłowy licznik publicznych ofert.');
  }
  return total;
}

/** Wiersze jednej strony listy (bez licznika). */
async function readRows(
  transaction: TransactionQuery,
  params: GetJobsParams,
  values: unknown[],
  page: number,
  pageSize: number,
): Promise<PublicJobRow[]> {
  // #593: strona POZA rzeczywistą granicą danych (naturalny offset > 10 000) nie odpytuje
  // RPC — inaczej różne numery stron zmapowałyby się na ten sam klampowany offset i
  // zwróciły identyczny wycinek. Jawny, pusty koniec listy zamiast duplikatu.
  if (isJobListPageBeyondLimit(page, pageSize)) return [];
  // to_jsonb zachowuje daty jako tekst ISO oraz liczby/NULL/tablice, bez parserów
  // typów pg zmieniających timestamptz/date na obiekty Date w starej warstwie UI.
  const result = (await transaction.query(
    `SELECT to_jsonb(job) AS job
    FROM public.get_public_jobs(${FILTER_ARGUMENTS},
      p_sort => $15::text, p_limit => $16::integer, p_offset => $17::integer) AS job`,
    [...values, params.sort ?? 'newest', pageSize, jobListNaturalOffset(page, pageSize)],
  )) as { rows: { job: PublicJobRow }[] };
  return result.rows.map((row) => row.job);
}

/**
 * Wyłącznie publiczne RPC. Domyślnie pod anon; `viewerId` (UUID ze zweryfikowanej sesji
 * serwera, nigdy z URL/formularza) uruchamia te same RPC pod tożsamością kandydata, żeby
 * pominąć oferty firm, które zablokował (#97, 0090). Wynik gościa się nie zmienia.
 */
export async function getPublicJobs(
  pool: TransactionPool,
  params: GetJobsParams,
  viewerId: string | null = null,
): Promise<PublicJobsResult> {
  const page = positiveInteger(params.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positiveInteger(params.pageSize, 12, 100);
  const values = filterValues(params);
  return withUserTransaction(pool, viewerId, async (transaction) => {
    const total = await readCount(transaction, values);
    const rows = await readRows(transaction, params, values, page, pageSize);
    return { rows, total, page, pageSize, maxPage: jobListLastPage(total, pageSize) };
  });
}

/**
 * PERF-04 (#1230): ta sama strona listy co `getPublicJobs`, BEZ `get_public_jobs_count` — dla
 * sekcji pomocniczych (strona główna, podobne oferty, pulpit kandydata, partie sitemap), które
 * licznika nie pokazują. Jeden przebieg RPC zamiast dwóch.
 */
export async function getPublicJobsPage(
  pool: TransactionPool,
  params: GetJobsParams,
  viewerId: string | null = null,
): Promise<Pick<PublicJobsResult, 'rows' | 'page' | 'pageSize'>> {
  const page = positiveInteger(params.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positiveInteger(params.pageSize, 12, 100);
  const values = filterValues(params);
  return withUserTransaction(pool, viewerId, async (transaction) => ({
    rows: await readRows(transaction, params, values, page, pageSize),
    page,
    pageSize,
  }));
}

export async function getPublicJobsCount(
  pool: TransactionPool,
  params: GetJobsParams,
): Promise<number> {
  return withUserTransaction(pool, null, (transaction) =>
    readCount(transaction, filterValues(params)),
  );
}

type FilterFacetRow = { dimension: unknown; key: unknown; total: unknown };

/** Jeden publiczny agregat dla wszystkich badge'y listy i bieżącego zestawu filtrów. */
export async function getPublicJobFilterFacets(
  pool: TransactionPool,
  params: GetJobsParams,
  viewerId: string | null = null,
): Promise<JobFilterFacets> {
  return withUserTransaction(pool, viewerId, async (transaction) => {
    // #1119 (0996): pozycja „miasto” w języku widoku (`location_display_name`: nazwa z
    // `location_names`, tylko gdy wskazuje tę samą miejscowość — jest też wartością filtra).
    // Nazwę podmienia zapytanie wokół RPC, więc treść facetów w bazie zostaje bez zmian.
    const result = (await transaction.query(
      `SELECT f.dimension,
              CASE WHEN f.dimension = 'location'
                   THEN public.location_display_name(f.key, $1::text) ELSE f.key END AS key,
              to_jsonb(f.total) AS total
       FROM public.get_public_job_filter_facets(${FILTER_ARGUMENTS}) AS f`,
      filterValues(params),
    )) as { rows: FilterFacetRow[] };
    const facets: JobFilterFacets = {
      total: 0,
      categories: {},
      locations: [],
      contracts: {},
      accommodation: { provided: 0, unavailable: 0 },
      immediate: 0,
      noLanguage: 0,
    };
    for (const row of result.rows) {
      if (
        typeof row.dimension !== 'string' ||
        typeof row.key !== 'string' ||
        typeof row.total !== 'number' ||
        !Number.isSafeInteger(row.total) ||
        row.total < 0
      ) {
        throw new Error('Nieprawidłowe facety publicznych ofert.');
      }
      if (row.dimension === 'total' && row.key === 'all')
        facets.total = row.total;
      else if (row.dimension === 'category')
        facets.categories[row.key] = row.total;
      else if (row.dimension === 'location') {
        // Dwie pozycje z tą samą nazwą w języku widoku = jedna pozycja z sumą ofert.
        const same = facets.locations.find((entry) => entry.city === row.key);
        if (same) same.count += row.total;
        else facets.locations.push({ city: row.key, count: row.total });
      }
      else if (row.dimension === 'contract')
        facets.contracts[row.key] = row.total;
      else if (
        row.dimension === 'accommodation' &&
        (row.key === 'provided' || row.key === 'unavailable')
      ) {
        facets.accommodation[row.key] = row.total;
      } else if (row.dimension === 'additional' && row.key === 'immediate')
        facets.immediate = row.total;
      else if (row.dimension === 'additional' && row.key === 'no_language')
        facets.noLanguage = row.total;
      else if (row.dimension === 'additional' && row.key === 'direct')
        facets.direct = row.total;
      else throw new Error('Nieznany wymiar facetów publicznych ofert.');
    }
    facets.locations.sort(
      (a, b) => b.count - a.count || a.city.localeCompare(b.city),
    );
    return facets;
  });
}

type FacetCountRow = { key: unknown; total: unknown };

function facetCounts(
  keys: readonly string[],
  rows: FacetCountRow[],
): Record<string, number> {
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

export async function getPublicJob(
  pool: TransactionPool,
  slug: string,
  requestedLocale: string,
): Promise<PublicJobRow | null> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT to_jsonb(job) AS job
      FROM public.get_public_job(p_slug => $1::text, p_locale => $2::text) AS job`,
    [slug, locale(requestedLocale)],
    )) as { rows: { job: PublicJobRow }[] };
    return result.rows[0]?.job ?? null;
  });
}

export interface PublicJobTranslationRow {
  job_id: string;
  locale: string;
  title: string;
  description: string | null;
}

/**
 * Języki, w których publiczne oferty mają tłumaczenie treści (#301). Odczyt pod rolą anon;
 * RLS `job_translations_select` przepuszcza tylko oferty publiczne (`job_is_public`).
 * Tytuł i opis pozwalają ustalić, które tłumaczenie zwróciło `get_public_job`, bo RPC nie
 * zwraca jego języka.
 */
export async function getPublicJobTranslations(
  pool: TransactionPool,
  jobIds: readonly string[],
): Promise<PublicJobTranslationRow[]> {
  if (jobIds.length === 0) return [];
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT job_id::text AS job_id, locale, title, description
       FROM public.job_translations
       WHERE job_id = ANY($1::uuid[])
       ORDER BY job_id, locale`,
      [jobIds],
    )) as { rows: PublicJobTranslationRow[] };
    return result.rows.filter((row) => isLocale(row.locale));
  });
}

export interface PublicJobMachineTranslationRow {
  source_locale: string;
  origin: string;
  fields: Record<string, unknown>;
}

/**
 * Przekład oferty w języku widza (#33, 0159). RPC pod rolą anon zwraca wiersz tylko dla
 * oferty publicznej, bieżącej rewizji i języka bez własnego tłumaczenia; tylko pola
 * wyświetlane na stronie. Brak wiersza = brak aktualnego przekładu.
 */
export async function getPublicJobMachineTranslation(
  pool: TransactionPool,
  jobId: string,
  requestedLocale: string,
): Promise<PublicJobMachineTranslationRow | null> {
  if (!isLocale(requestedLocale)) return null;
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT source_locale, origin, fields
       FROM public.get_public_job_machine_translation(p_job_id => $1::uuid, p_locale => $2::text)`,
      [jobId, requestedLocale],
    )) as { rows: PublicJobMachineTranslationRow[] };
    return result.rows[0] ?? null;
  });
}

export interface PublicJobListMachineTitleRow extends PublicJobMachineTranslationRow {
  job_id: string;
}

/** Najwięcej ofert w jednym odczycie przekładów listy — tyle, ile zwraca `get_public_jobs`. */
export const MACHINE_TITLES_BATCH_LIMIT = 100;

/**
 * Przekłady tytułu i wyróżników kart ofert (#33, 0160) — JEDNO zapytanie na stronę listy.
 * RPC pod rolą anon zwraca wiersz tylko dla oferty publicznej z aktualnym przekładem w języku
 * bez własnego tłumaczenia; tylko pola karty. Brak wiersza = karta w oryginale.
 */
export async function getPublicJobsMachineTitles(
  pool: TransactionPool,
  jobIds: readonly string[],
  requestedLocale: string,
): Promise<PublicJobListMachineTitleRow[]> {
  if (jobIds.length === 0 || !isLocale(requestedLocale)) return [];
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT job_id::text AS job_id, source_locale, origin, fields
       FROM public.get_public_jobs_machine_titles(p_job_ids => $1::uuid[], p_locale => $2::text)`,
      [jobIds.slice(0, MACHINE_TITLES_BATCH_LIMIT), requestedLocale],
    )) as { rows: PublicJobListMachineTitleRow[] };
    return result.rows;
  });
}

/**
 * 0167: które z podanych ofert publicznych pochodzą od agencji pracy tymczasowej
 * (`get_public_jobs_agency`, pod rolą anon, najwyżej 100 identyfikatorów na wywołanie).
 */
export async function getPublicJobsAgency(
  pool: TransactionPool,
  jobIds: readonly string[],
): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT job_id::text AS job_id FROM public.get_public_jobs_agency(p_job_ids => $1::uuid[])`,
      [jobIds.slice(0, 100)],
    )) as { rows: { job_id: string }[] };
    return new Set(result.rows.map((row) => row.job_id));
  });
}

/**
 * Pytania screeningowe publicznej oferty (#101) — RPC `get_public_job_screening_questions`
 * (0093) pod rolą anon zwraca wiersze tylko dla oferty publicznej (`job_is_public`).
 */
/**
 * Koszty i dodatki oferty publicznej (0169). RPC pod rolą anon zwraca wiersz tylko dla oferty
 * publicznej (`job_is_public`); numeric przychodzi jako tekst (parser: `parseJobCostsRow`).
 */
export async function getPublicJobCosts(
  pool: TransactionPool,
  jobId: string,
): Promise<PublicJobRow | null> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT accommodation_kind, accommodation_cost::text AS accommodation_cost,
              accommodation_cost_period, accommodation_deducted, accommodation_registration,
              accommodation_after_contract, transport_shuttle, transport_reimbursed,
              meal_voucher_daily::text AS meal_voucher_daily, joint_committee
       FROM public.get_public_job_costs(p_job_id => $1::uuid)`,
      [jobId],
    )) as { rows: PublicJobRow[] };
    return result.rows[0] ?? null;
  });
}

export async function getPublicJobScreeningQuestions(
  pool: TransactionPool,
  jobId: string,
): Promise<PublicJobRow[]> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT id::text AS id, position, type, required, prompt, options
       FROM public.get_public_job_screening_questions(p_job_id => $1::uuid)`,
      [jobId],
    )) as { rows: PublicJobRow[] };
    return result.rows;
  });
}
