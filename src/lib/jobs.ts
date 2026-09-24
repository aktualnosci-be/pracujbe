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
import { demoJobContentLocales, resolveDemoJobBySlug, resolveDemoJobs } from '@/lib/data/demo';
import { resolveJobContentLocales } from '@/lib/job-content-locale';
import { compareSalaryDesc, salaryInRange, type SalaryUnit } from '@/lib/salary-compare';
import type { TransactionPool } from '@/lib/db/transaction';

export type ContractType =
  | 'permanent'
  | 'temporary'
  | 'interim'
  | 'freelance'
  | 'internship'
  | 'seasonal';

export type SalaryPeriod = 'hour' | 'month' | 'year';

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
  salaryPeriod?: SalaryPeriod;
  publishedAt: string;
  isNew: boolean;
  highlights: string[];
  category: CategoryKey;
  accommodation: boolean;
  immediate: boolean;
  noLanguageRequired: boolean;
  /**
   * Oferta z zestawu demonstracyjnego (#297, Invariant #12) — fikcyjna firma i treść. UI
   * oznacza ją jako przykładową, nie pokazuje odznaki weryfikacji, nie emituje JobPosting
   * i nie pozwala aplikować. Oferty z bazy nigdy nie mają tej flagi.
   */
  isDemo?: true;
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
  /** Data wygaśnięcia oferty (ISO) — do JSON-LD validThrough (P1-12). */
  expiresAt?: string;
  /** Język treści (tytuł, opis, listy) — może różnić się od języka strony; brak = nieznany (#301). */
  contentLocale?: Locale;
  /** Języki z własnym tłumaczeniem treści; brak = nieznane, traktowane jak wszystkie (#301). */
  availableLocales?: Locale[];
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
  /** Jednostka widełek i sortowania po wynagrodzeniu (#188, 0091); domyślnie 'month'. */
  salaryUnit?: SalaryUnit;
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
  'permanent',
  'temporary',
  'interim',
  'freelance',
  'internship',
  'seasonal',
];
const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
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

/**
 * Serwer fixture E2E (`playwright.applications-fixture.config.ts`, tryb `full`): oferty
 * fikcyjne zastępują realny backend, więc nie są oznaczane jako demo — tam testujemy
 * formularz aplikowania i JobPosting. Nie działa w buildzie produkcyjnym.
 */
function isRealJobsFixture(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full';
}

/**
 * Czy publiczne strony pokazują zestaw demonstracyjny (brak bazy poza APP_MODE=production).
 * Strony z ofertami pokazują wtedy baner „dane przykładowe” (#297).
 */
export function isShowingDemoJobs(): boolean {
  return !isDatabaseConfigured() && !isProductionMode() && !isRealJobsFixture();
}

function markDemo<T extends JobListItem>(job: T): T {
  return isRealJobsFixture() ? job : { ...job, isDemo: true };
}

function newestFirst(a: JobListItem, b: JobListItem): number {
  return b.publishedAt.localeCompare(a.publishedAt);
}

function getJobsFromDemo(
  locale: Locale,
  params: GetJobsParams,
  page: number,
  pageSize: number,
): GetJobsResult {
  let jobs: JobDetail[] = resolveDemoJobs(locale).map(markDemo);

  // Kategorie/typy umów: pojedyncze (landing) + tablice (sidebar) połączone (P1-12).
  const categories =
    params.categories ?? (params.category ? [params.category] : undefined);
  const contractTypes =
    params.contractTypes ??
    (params.contractType ? [params.contractType] : undefined);
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
        (job) =>
          job.city.toLowerCase().includes(q) ||
          job.slug.toLowerCase().includes(q),
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
  // Widełki w wybranej jednostce (#188, reguła jak w SQL 0080/0091): oferta bez
  // porównywalnej kwoty (brak wynagrodzenia albo inny okres stawki) NIE jest wykluczana.
  const salaryUnit = params.salaryUnit ?? 'month';
  if (params.salaryMin !== undefined || params.salaryMax !== undefined) {
    const lo = params.salaryMin ?? 0;
    const hi = params.salaryMax ?? Number.POSITIVE_INFINITY;
    jobs = jobs.filter((job) => salaryInRange(job, lo, hi, salaryUnit));
  }
  if (params.accommodation !== undefined) {
    jobs = jobs.filter((job) => job.accommodation === params.accommodation);
  }
  if (params.immediate) jobs = jobs.filter((job) => job.immediate);
  if (params.noLanguageRequired)
    jobs = jobs.filter((job) => job.noLanguageRequired);
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
      ? (a, b) => compareSalaryDesc(a, b, salaryUnit) || newestFirst(a, b)
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
  return CONTRACT_TYPES.includes(v as ContractType)
    ? (v as ContractType)
    : 'permanent';
}

function asCategory(value: unknown): CategoryKey {
  const v = asString(value);
  return CATEGORY_KEYS.includes(v as CategoryKey)
    ? (v as CategoryKey)
    : 'logistics';
}

function asSalaryPeriod(value: unknown): SalaryPeriod | undefined {
  return value === 'hour' || value === 'month' || value === 'year'
    ? value
    : undefined;
}

function computeIsNew(publishedAt: string): boolean {
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

function rowToJobListItem(row: unknown): JobListItem {
  const r = asRecord(row);
  const publishedAt = asString(r['published_at'], new Date().toISOString());
  const salaryPeriod = asSalaryPeriod(r['salary_period']);
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
    ...(salaryPeriod ? { salaryPeriod } : {}),
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
    ...(asOptString(r['expires_at'])
      ? { expiresAt: asOptString(r['expires_at']) }
      : {}),
  };
}

async function getJobsFromDb(
  params: GetJobsParams,
  page: number,
  pageSize: number,
  viewerId: string | null,
): Promise<GetJobsResult> {
  const [{ getDomainPool }, { getPublicJobs }] = await Promise.all([
    import('@/lib/db/runtime'),
    import('@/lib/db/public-jobs'),
  ]);
  const result = await getPublicJobs(await getDomainPool(), {
    ...params,
    page,
    pageSize,
  }, viewerId);
  return {
    jobs: result.rows.map(rowToJobListItem),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

async function getJobBySlugFromDb(
  slug: string,
  locale: string,
): Promise<JobDetail | null> {
  const [{ getDomainPool }, { getPublicJob }] = await Promise.all([
    import('@/lib/db/runtime'),
    import('@/lib/db/public-jobs'),
  ]);
  const pool = await getDomainPool();
  const first = await getPublicJob(pool, slug, locale);
  if (!first) return null;
  const job = rowToJobDetail(first);
  return { ...job, ...(await readContentLocales(pool, job, toLocale(locale))) };
}

/**
 * Języki treści oferty (#301). Odczyt pomocniczy: jego awaria nie może zablokować strony oferty,
 * więc błąd jest logowany, a oferta zachowuje się jak dotąd (język nieznany).
 */
async function readContentLocales(
  pool: TransactionPool,
  job: JobDetail,
  locale: Locale,
): Promise<Pick<JobDetail, 'contentLocale' | 'availableLocales'>> {
  try {
    const { getPublicJobTranslations } = await import('@/lib/db/public-jobs');
    const rows = await getPublicJobTranslations(pool, [job.id]);
    const resolved = resolveJobContentLocales(locale, job, rows);
    if (resolved.availableLocales.length === 0) return {};
    return {
      availableLocales: resolved.availableLocales,
      ...(resolved.contentLocale ? { contentLocale: resolved.contentLocale } : {}),
    };
  } catch (error) {
    captureError(error, { area: 'jobs.readContentLocales', jobId: job.id });
    return {};
  }
}

/* ---------------------------------------------------------------------------
 * Publiczne API (kontrakt @/lib/jobs)
 * ------------------------------------------------------------------------- */

/**
 * Kontekst osoby przeglądającej listę. `candidateId` wyłącznie ze zweryfikowanej sesji
 * serwera (`readCandidateViewerId`); brak = gość, wynik wspólny (ISR/statyczne strony).
 */
export interface JobsViewer {
  candidateId: string | null;
}

export async function getJobs(
  params: GetJobsParams,
  viewer?: JobsViewer,
): Promise<GetJobsResult> {
  const locale = toLocale(params.locale);
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE),
  );

  if (isDatabaseConfigured()) {
    try {
      return await getJobsFromDb(params, page, pageSize, viewer?.candidateId ?? null);
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

export async function getJobBySlug(
  slug: string,
  locale: string,
): Promise<JobDetail | null> {
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
  const job = resolveDemoJobBySlug(slug, resolvedLocale);
  return job ? markDemo(job) : null;
}

/**
 * Jawny wynik odczytu podobnych ofert (#191). Sekcja pomocnicza: jej awaria nie może
 * przerwać renderowania szczegółu oferty ani aplikowania, a „brak podobnych” wolno pokazać
 * tylko po udanym odczycie.
 */
export type SimilarJobsLoad =
  | { status: 'ok'; jobs: JobListItem[] }
  | { status: 'error' };

/**
 * Wymusza błąd odczytu podobnych ofert na izolowanym serwerze dev testów E2E
 * (`playwright.applications-fixture.config.ts`). Nie działa w buildzie produkcyjnym.
 */
function isSimilarJobsErrorFixture(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'error';
}

/** Do `limit` aktywnych ofert z tej samej kategorii, bez oferty bieżącej. */
export async function getSimilarJobs(
  job: Pick<JobListItem, 'slug' | 'category'>,
  locale: string,
  limit: number,
): Promise<SimilarJobsLoad> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  try {
    if (isSimilarJobsErrorFixture()) throw new Error('Isolated similar jobs fixture failure');
    const result = await getJobs({ locale, category: job.category, page: 1, pageSize: safeLimit + 1 });
    return {
      status: 'ok',
      jobs: result.jobs.filter((item) => item.slug !== job.slug).slice(0, safeLimit),
    };
  } catch (error) {
    captureError(error, { area: 'jobs.getSimilarJobs' });
    return { status: 'error' };
  }
}

export async function getLatestJobs(
  locale: string,
  limit: number = DEFAULT_LATEST_LIMIT,
): Promise<JobListItem[]> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const result = await getJobs({ locale, page: 1, pageSize: safeLimit });
  return result.jobs;
}

export async function getJobFilterFacets(params: GetJobsParams, viewer?: JobsViewer) {
  if (!isDatabaseConfigured()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobFilterFacets }] = await Promise.all(
      [import('@/lib/db/runtime'), import('@/lib/db/public-jobs')],
    );
    return await getPublicJobFilterFacets(
      await getDomainPool(),
      params,
      viewer?.candidateId ?? null,
    );
  } catch (error) {
    captureError(error, { area: 'jobs.getJobFilterFacets' });
    throw new AppError('INTERNAL');
  }
}

/**
 * Języki z własnym tłumaczeniem dla listy ofert (sitemap, #301). `null` = nieznane (błąd odczytu);
 * oferta bez wpisu w wyniku nie ma żadnego tłumaczenia.
 */
export async function getJobsAvailableLocales(
  jobIds: readonly string[],
): Promise<Record<string, Locale[]> | null> {
  if (!isDatabaseConfigured()) {
    return Object.fromEntries(jobIds.map((id) => [id, demoJobContentLocales(id)]));
  }
  try {
    const [{ getDomainPool }, { getPublicJobTranslations }] = await Promise.all([
      import('@/lib/db/runtime'),
      import('@/lib/db/public-jobs'),
    ]);
    const rows = await getPublicJobTranslations(await getDomainPool(), jobIds);
    const result: Record<string, Locale[]> = {};
    for (const row of rows) {
      const locale = toLocale(row.locale);
      const list = (result[row.job_id] ??= []);
      if (!list.includes(locale)) list.push(locale);
    }
    return result;
  } catch (error) {
    captureError(error, { area: 'jobs.getJobsAvailableLocales' });
    return null;
  }
}

/**
 * P1-09: REALNE liczniki ofert per kategoria (koniec zmyślonych liczb na stronie głównej).
 * Zwraca `null` w trybie demo (brak env) — komponent pomija wtedy badge zamiast pokazywać
 * konkretną, nieprawdziwą liczbę. Liczy dokładnie tym samym filtrem, którym link kieruje na
 * listę (`category=<key>`), więc licznik odpowiada temu, co użytkownik zobaczy po kliknięciu.
 */
export async function getCategoryCounts(
  _locale: string,
  keys: readonly string[],
): Promise<Record<string, number> | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobCategoryCounts }] =
      await Promise.all([
        import('@/lib/db/runtime'),
        import('@/lib/db/public-jobs'),
    ]);
    const pool = await getDomainPool();
    const validKeys = keys.filter((key) =>
      CATEGORY_KEYS.includes(key as CategoryKey),
    );
    const counts = await getPublicJobCategoryCounts(pool, validKeys);
    return Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]));
  } catch (error) {
    captureError(error, { area: 'jobs.getCategoryCounts' });
    return null;
  }
}

/**
 * P1-09 / #189: REALNE liczniki ofert per KLUCZ miasta (nie per przetłumaczona nazwa). Liczy z
 * facetu lokalizacji i sumuje dokładne aliasy klucza (Bruksela/Brussel/Bruxelles/Brussels) —
 * tą samą regułą, którą landing i lista filtrują oferty, więc licznik nie zależy od języka
 * strony ani języka, w którym wpisano miasto oferty. `null` w trybie demo.
 */
export async function getCityCounts(
  locale: string,
  keys: readonly LocationKey[],
): Promise<Record<LocationKey, number> | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobFilterFacets }, { countByLocationKey }] =
      await Promise.all([
        import('@/lib/db/runtime'),
        import('@/lib/db/public-jobs'),
        import('@/lib/locations/city-aliases'),
      ]);
    const facets = await getPublicJobFilterFacets(await getDomainPool(), { locale });
    return countByLocationKey(facets.locations, keys);
  } catch (error) {
    captureError(error, { area: 'jobs.getCityCounts' });
    return null;
  }
}
