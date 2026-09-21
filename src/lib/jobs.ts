/**
 * Warstwa dostępu do danych ofert pracy — Pracuj.be.
 *
 * Publiczne RPC PostgreSQL działają pod ograniczoną rolą anon. Adapter importowany
 * jest leniwie. Demo działa wyłącznie poza APP_MODE=production i bez konfiguracji DB;
 * awaria skonfigurowanej bazy nigdy nie pokazuje fikcyjnych ofert.
 */

import { isDatabaseConfigured, isProductionMode } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
import { routing, type Locale } from '@/i18n/routing';
import { resolveDemoJobBySlug, resolveDemoJobs } from '@/lib/data/demo';

export type ContractType =
  | 'permanent'
  | 'temporary'
  | 'interim'
  | 'freelance'
  | 'internship'
  | 'seasonal';

export type CategoryKey =
  | 'construction'
  | 'transport'
  | 'warehouse'
  | 'production'
  | 'technical'
  | 'cleaning'
  | 'hospitality'
  | 'care'
  | 'logistics'
  | 'seasonal';

export type LocationKey =
  | 'brussels'
  | 'antwerp'
  | 'ghent'
  | 'leuven'
  | 'mechelen'
  | 'hasselt'
  | 'liege'
  | 'charleroi'
  | 'bruges'
  | 'kortrijk';

export interface JobListItem {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  companyVerified: boolean;
  city: string;
  region: string;
  contractType: ContractType;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  publishedAt: string;
  isNew: boolean;
  highlights: string[];
  category: CategoryKey;
  accommodation: boolean;
  immediate: boolean;
  noLanguageRequired: boolean;
}

export interface JobDetail extends JobListItem {
  description: string;
  responsibilities: string[];
  requirementsMandatory: string[];
  requirementsOptional: string[];
  conditions: string[];
  workingHours: string;
  shifts?: string;
  languages: string[];
  transport: boolean;
  startDate?: string;
  companyDescription: string;
  /** Okres pensji (hour/month/year) — do JSON-LD unitText (P1-12). */
  salaryPeriod?: 'hour' | 'month' | 'year';
  /** Data wygaśnięcia oferty (ISO) — do JSON-LD validThrough (P1-12). */
  expiresAt?: string;
}

export interface GetJobsParams {
  locale: string;
  keyword?: string;
  city?: string;
  /** Pojedyncza kategoria (landing pages) — łączona z `categories` przy zapytaniu. */
  category?: CategoryKey;
  /** Pojedynczy typ umowy (landing pages) — łączony z `contractTypes`. */
  contractType?: ContractType;
  // --- Filtry zaawansowane sidebara (P1-12: liczone w SQL, nie w pamięci) ---
  categories?: CategoryKey[];
  locations?: string[];
  contractTypes?: ContractType[];
  salaryMin?: number;
  salaryMax?: number;
  /** true=tylko z zakwaterowaniem, false=tylko bez, undefined=bez filtra. */
  accommodation?: boolean;
  immediate?: boolean;
  noLanguageRequired?: boolean;
  /** ISO timestamp — tylko oferty opublikowane >= tej daty (filtr „data"). */
  since?: string;
  /** Sortowanie wyników: 'newest' (domyślne) lub 'salary'. */
  sort?: 'newest' | 'salary';
  page?: number;
  pageSize?: number;
}

export interface GetJobsResult {
  jobs: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_LATEST_LIMIT = 6;
const NEW_DAYS = 10;

const CONTRACT_TYPES: readonly ContractType[] = [
  'permanent', 'temporary', 'interim', 'freelance', 'internship', 'seasonal',
];
const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction', 'transport', 'warehouse', 'production', 'technical',
  'cleaning', 'hospitality', 'care', 'logistics', 'seasonal',
];

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

/* ---------------------------------------------------------------------------
 * Ścieżka DEMO (fallback bez bazy)
 * ------------------------------------------------------------------------- */

function newestFirst(a: JobListItem, b: JobListItem): number {
  return b.publishedAt.localeCompare(a.publishedAt);
}

function getJobsFromDemo(
  locale: Locale,
  params: GetJobsParams,
  page: number,
  pageSize: number,
): GetJobsResult {
  let jobs: JobDetail[] = resolveDemoJobs(locale);

  // Kategorie/typy umów: pojedyncze (landing) + tablice (sidebar) połączone (P1-12).
  const categories = params.categories ?? (params.category ? [params.category] : undefined);
  const contractTypes = params.contractTypes ?? (params.contractType ? [params.contractType] : undefined);
  if (categories && categories.length > 0) {
    jobs = jobs.filter((job) => categories.includes(job.category));
  }
  if (contractTypes && contractTypes.length > 0) {
    jobs = jobs.filter((job) => contractTypes.includes(job.contractType));
  }
  if (params.locations && params.locations.length > 0) {
    const locs = params.locations;
    jobs = jobs.filter((job) => locs.includes(job.city));
  }
  if (params.city) {
    const q = params.city.trim().toLowerCase();
    if (q) {
      jobs = jobs.filter(
        (job) => job.city.toLowerCase().includes(q) || job.slug.toLowerCase().includes(q),
      );
    }
  }
  if (params.keyword) {
    const q = params.keyword.trim().toLowerCase();
    if (q) {
      jobs = jobs.filter(
        (job) =>
          job.title.toLowerCase().includes(q) ||
          job.companyName.toLowerCase().includes(q) ||
          job.description.toLowerCase().includes(q) ||
          job.highlights.some((h) => h.toLowerCase().includes(q)),
      );
    }
  }
  // Widełki: oferta bez podanego wynagrodzenia NIE jest wykluczana.
  if (params.salaryMin !== undefined || params.salaryMax !== undefined) {
    const lo = params.salaryMin ?? 0;
    const hi = params.salaryMax ?? Number.POSITIVE_INFINITY;
    jobs = jobs.filter((job) => {
      if (job.salaryMin === undefined && job.salaryMax === undefined) return true;
      const iMax = job.salaryMax ?? job.salaryMin ?? 0;
      const iMin = job.salaryMin ?? job.salaryMax ?? 0;
      return iMax >= lo && iMin <= hi;
    });
  }
  if (params.accommodation !== undefined) {
    jobs = jobs.filter((job) => job.accommodation === params.accommodation);
  }
  if (params.immediate) jobs = jobs.filter((job) => job.immediate);
  if (params.noLanguageRequired) jobs = jobs.filter((job) => job.noLanguageRequired);
  if (params.since) {
    const sinceTs = Date.parse(params.since);
    if (!Number.isNaN(sinceTs)) {
      jobs = jobs.filter((job) => {
        const ts = Date.parse(job.publishedAt);
        return !Number.isNaN(ts) && ts >= sinceTs;
      });
    }
  }

  const sorted = [...jobs].sort(
    params.sort === 'salary'
      ? (a, b) => (b.salaryMax ?? b.salaryMin ?? 0) - (a.salaryMax ?? a.salaryMin ?? 0) || newestFirst(a, b)
      : newestFirst,
  );
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const paged = sorted.slice(start, start + pageSize);

  return { jobs: paged, total, page, pageSize };
}

/* ---------------------------------------------------------------------------
 * Ścieżka PostgreSQL — błąd propagowany, bez fallbacku do fikcyjnych ofert
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumberOpt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asContractType(value: unknown): ContractType {
  const v = asString(value);
  return CONTRACT_TYPES.includes(v as ContractType) ? (v as ContractType) : 'permanent';
}

function asCategory(value: unknown): CategoryKey {
  const v = asString(value);
  return CATEGORY_KEYS.includes(v as CategoryKey) ? (v as CategoryKey) : 'logistics';
}

function computeIsNew(publishedAt: string): boolean {
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

function rowToJobListItem(row: unknown): JobListItem {
  const r = asRecord(row);
  const publishedAt = asString(r['published_at'], new Date().toISOString());
  return {
    id: asString(r['id']),
    slug: asString(r['slug']),
    title: asString(r['title']),
    companyName: asString(r['company_name']),
    companyVerified: asBool(r['company_verified']),
    city: asString(r['city']),
    region: asString(r['region']),
    contractType: asContractType(r['contract_type']),
    salaryMin: asNumberOpt(r['salary_min']),
    salaryMax: asNumberOpt(r['salary_max']),
    currency: asString(r['currency'], 'EUR'),
    publishedAt,
    isNew: computeIsNew(publishedAt),
    highlights: asStringArray(r['highlights']),
    category: asCategory(r['category']),
    accommodation: asBool(r['accommodation']),
    immediate: asBool(r['immediate']),
    noLanguageRequired: asBool(r['no_language_required']),
  };
}

function rowToJobDetail(row: unknown): JobDetail {
  const r = asRecord(row);
  const period = asOptString(r['salary_period']);
  const salaryPeriod =
    period === 'hour' || period === 'month' || period === 'year' ? period : undefined;
  return {
    ...rowToJobListItem(row),
    description: asString(r['description']),
    responsibilities: asStringArray(r['responsibilities']),
    requirementsMandatory: asStringArray(r['requirements_mandatory']),
    requirementsOptional: asStringArray(r['requirements_optional']),
    conditions: asStringArray(r['conditions']),
    workingHours: asString(r['working_hours']),
    shifts: asOptString(r['shifts']),
    languages: asStringArray(r['languages']),
    transport: asBool(r['transport']),
    startDate: asOptString(r['start_date']),
    companyDescription: asString(r['company_description']),
    ...(salaryPeriod ? { salaryPeriod } : {}),
    ...(asOptString(r['expires_at']) ? { expiresAt: asOptString(r['expires_at']) } : {}),
  };
}

async function getJobsFromDb(
  params: GetJobsParams,
  page: number,
  pageSize: number,
): Promise<GetJobsResult> {
  const [{ getDomainPool }, { getPublicJobs }] = await Promise.all([
    import('@/lib/db/runtime'), import('@/lib/db/public-jobs'),
  ]);
  const result = await getPublicJobs(await getDomainPool(), { ...params, page, pageSize });
  return { jobs: result.rows.map(rowToJobListItem), total: result.total, page: result.page, pageSize: result.pageSize };
}

async function getJobBySlugFromDb(slug: string, locale: string): Promise<JobDetail | null> {
  const [{ getDomainPool }, { getPublicJob }] = await Promise.all([
    import('@/lib/db/runtime'), import('@/lib/db/public-jobs'),
  ]);
  const first = await getPublicJob(await getDomainPool(), slug, locale);
  return first ? rowToJobDetail(first) : null;
}

/* ---------------------------------------------------------------------------
 * Publiczne API (kontrakt @/lib/jobs)
 * ------------------------------------------------------------------------- */

export async function getJobs(params: GetJobsParams): Promise<GetJobsResult> {
  const locale = toLocale(params.locale);
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE));

  if (isDatabaseConfigured()) {
    try {
      return await getJobsFromDb(params, page, pageSize);
    } catch (error) {
      // Skonfigurowana baza NIE może po cichu degradować do danych demonstracyjnych
      // (fikcyjne oferty indeksowane jako realne). Loguj i propaguj kontrolowany błąd.
      captureError(error, { area: 'jobs.getJobs' });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  return getJobsFromDemo(locale, params, page, pageSize);
}

export async function getJobBySlug(slug: string, locale: string): Promise<JobDetail | null> {
  const resolvedLocale = toLocale(locale);

  if (isDatabaseConfigured()) {
    try {
      return await getJobBySlugFromDb(slug, resolvedLocale);
    } catch (error) {
      captureError(error, { area: 'jobs.getJobBySlug', slug });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  return resolveDemoJobBySlug(slug, resolvedLocale);
}

export async function getLatestJobs(
  locale: string,
  limit: number = DEFAULT_LATEST_LIMIT,
): Promise<JobListItem[]> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const result = await getJobs({ locale, page: 1, pageSize: safeLimit });
  return result.jobs;
}

/**
 * P1-09: REALNE liczniki ofert per kategoria (koniec zmyślonych liczb na stronie głównej).
 * Zwraca `null` w trybie demo (brak env) — komponent pomija wtedy badge zamiast pokazywać
 * konkretną, nieprawdziwą liczbę. Liczy dokładnie tym samym filtrem, którym link kieruje na
 * listę (`category=<key>`), więc licznik odpowiada temu, co użytkownik zobaczy po kliknięciu.
 */
export async function getCategoryCounts(
  locale: string,
  keys: readonly string[],
): Promise<Record<string, number> | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobsCount }] = await Promise.all([
      import('@/lib/db/runtime'), import('@/lib/db/public-jobs'),
    ]);
    const pool = await getDomainPool();
    const resolved = toLocale(locale);
    const entries = await Promise.all(
      keys.map(async (key) => {
        const total = CATEGORY_KEYS.includes(key as CategoryKey)
          ? await getPublicJobsCount(pool, { locale: resolved, categories: [key as CategoryKey] })
          : 0;
        return [key, total] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch (error) {
    captureError(error, { area: 'jobs.getCategoryCounts' });
    return null;
  }
}

/**
 * P1-09: REALNE liczniki ofert per miasto. Liczy filtrem `p_city` (ilike) — dokładnie tak, jak
 * link kieruje na listę (`city=<nazwa>`), więc licznik jest spójny z widokiem docelowym niezależnie
 * od znanego niedopasowania nazw miast (P1-10 — odrębne ustalenie). `null` w trybie demo.
 */
export async function getCityCounts(
  locale: string,
  cities: readonly string[],
): Promise<Record<string, number> | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobsCount }] = await Promise.all([
      import('@/lib/db/runtime'), import('@/lib/db/public-jobs'),
    ]);
    const pool = await getDomainPool();
    const resolved = toLocale(locale);
    const entries = await Promise.all(
      cities.map(async (city) => {
        const total = await getPublicJobsCount(pool, { locale: resolved, city });
        return [city, total] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch (error) {
    captureError(error, { area: 'jobs.getCityCounts' });
    return null;
  }
}
