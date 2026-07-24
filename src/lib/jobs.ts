/**
 * Warstwa dostępu do danych ofert pracy — Pracuj.be.
 *
 * Strategia (zgodna z Invariant #3): jeśli `isSupabaseConfigured()` — dane czytane są
 * z bazy (Supabase). W bloku `catch` (błąd zapytania / niepełny schemat) LUB gdy Supabase
 * NIE jest skonfigurowane — używamy danych demonstracyjnych z `@/lib/data/demo`
 * (z filtrowaniem i paginacją). Dzięki temu strona główna i lista ofert renderują się
 * BEZ zmiennych środowiskowych.
 *
 * Klient Supabase importowany jest LENIWIE (dynamic import) tylko na ścieżce bazodanowej —
 * moduł nie ciągnie `next/headers` do bundla trybu demo.
 */

import { isSupabaseConfigured } from '@/lib/env';
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
}

export interface GetJobsParams {
  locale: string;
  keyword?: string;
  city?: string;
  category?: CategoryKey;
  contractType?: ContractType;
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

  if (params.category) {
    jobs = jobs.filter((job) => job.category === params.category);
  }
  if (params.contractType) {
    jobs = jobs.filter((job) => job.contractType === params.contractType);
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

  const sorted = [...jobs].sort(newestFirst);
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const paged = sorted.slice(start, start + pageSize);

  return { jobs: paged, total, page, pageSize };
}

/* ---------------------------------------------------------------------------
 * Ścieżka BAZODANOWA (Supabase) — najlepszy wysiłek, z fallbackiem do demo
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
  };
}

async function getJobsFromDb(
  params: GetJobsParams,
  page: number,
  pageSize: number,
): Promise<GetJobsResult> {
  const { createServerClient } = await import('@/lib/supabase/server');
  const supabase = await createServerClient();

  // Publiczne dane WYŁĄCZNIE przez RPC get_public_jobs (0014): join firmy+tłumaczeń+wymagań,
  // fallback locale, tylko bezpieczne kolumny (bez VAT/e-mail/contact_email). Anon nie ma
  // dostępu do tabel bazowych. Filtrowanie/paginacja/licznik po stronie SQL (P1-02/P2-04).
  const rpcArgs = {
    p_locale: params.locale,
    p_keyword: params.keyword ?? null,
    p_city: params.city ?? null,
    p_category: params.category ?? null,
    p_contract_type: params.contractType ?? null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  };

  const [{ data, error }, { data: countData, error: countError }] = await Promise.all([
    supabase.rpc('get_public_jobs', rpcArgs),
    supabase.rpc('get_public_jobs_count', {
      p_locale: params.locale,
      p_keyword: params.keyword ?? null,
      p_city: params.city ?? null,
      p_category: params.category ?? null,
      p_contract_type: params.contractType ?? null,
    }),
  ]);

  if (error) throw error;
  if (countError) throw countError;

  const rows: unknown[] = Array.isArray(data) ? data : [];
  const jobs = rows.map(rowToJobListItem);
  const total = typeof countData === 'number' ? countData : jobs.length;
  return { jobs, total, page, pageSize };
}

async function getJobBySlugFromDb(slug: string, locale: string): Promise<JobDetail | null> {
  const { createServerClient } = await import('@/lib/supabase/server');
  const supabase = await createServerClient();

  const { data, error } = await supabase.rpc('get_public_job', {
    p_slug: slug,
    p_locale: locale,
  });

  if (error) throw error;
  const rows: unknown[] = Array.isArray(data) ? data : [];
  const first = rows[0];
  return first ? rowToJobDetail(first) : null;
}

/* ---------------------------------------------------------------------------
 * Publiczne API (kontrakt @/lib/jobs)
 * ------------------------------------------------------------------------- */

export async function getJobs(params: GetJobsParams): Promise<GetJobsResult> {
  const locale = toLocale(params.locale);
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE));

  if (isSupabaseConfigured()) {
    try {
      return await getJobsFromDb(params, page, pageSize);
    } catch (error) {
      // Skonfigurowana baza NIE może po cichu degradować do danych demonstracyjnych
      // (fikcyjne oferty indeksowane jako realne). Loguj i propaguj kontrolowany błąd.
      captureError(error, { area: 'jobs.getJobs' });
      throw new AppError('INTERNAL');
    }
  }

  return getJobsFromDemo(locale, params, page, pageSize);
}

export async function getJobBySlug(slug: string, locale: string): Promise<JobDetail | null> {
  const resolvedLocale = toLocale(locale);

  if (isSupabaseConfigured()) {
    try {
      return await getJobBySlugFromDb(slug, resolvedLocale);
    } catch (error) {
      captureError(error, { area: 'jobs.getJobBySlug', slug });
      throw new AppError('INTERNAL');
    }
  }

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
