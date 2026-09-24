import type { GetJobsParams } from '@/lib/jobs';
import { resolveCityFilters } from '@/lib/locations/city-aliases';
import {
  SALARY_MAX_BOUND,
  isSalaryNarrowed,
  parseSidebarFilters,
  parseSort,
  sidebarFiltersToParams,
  type SidebarFilters,
  type SortValue,
} from '@/components/public/job-filters';

/**
 * Filtry listy ofert z adresu URL — jedno źródło dla `/oferty-pracy` i zapisu wyszukiwania
 * (#100). Zapisane wyszukiwanie przechowuje dokładnie te argumenty `get_public_jobs`, które
 * lista wysłała dla tego adresu (po rozwinięciu aliasów miast), więc alert liczony w SQL
 * nie może się rozjechać z tym, co kandydat widział. Moduł bez I/O (testowalny).
 */

export type FlatSearchParams = Record<string, string | undefined>;

const DAY_MS = 86_400_000;

/** Parametry zapytania SQL listy (bez sortowania i paginacji). */
export type JobListFilterParams = Omit<GetJobsParams, 'sort' | 'page' | 'pageSize'>;

export interface JobListQuery {
  keyword?: string;
  city?: string;
  sort: SortValue;
  sidebar: SidebarFilters;
  cityFilters: ReturnType<typeof resolveCityFilters>;
  filterParams: JobListFilterParams;
}

export function parseJobListQuery(flat: FlatSearchParams, locale: string, now = Date.now()): JobListQuery {
  const keyword = flat['keyword']?.trim() || undefined;
  const city = flat['city']?.trim() || undefined;
  const sort = parseSort(flat['sort']);
  const sidebar = parseSidebarFilters(flat);
  // #189: miasto z adresu może pochodzić z innej wersji językowej — zapytanie obejmuje
  // wszystkie nazwy miasta, więc zbiór ofert nie zależy od języka.
  const cityFilters = resolveCityFilters({ city, locations: sidebar.locations }, locale);

  const sinceWindow =
    sidebar.date === '24h' ? DAY_MS : sidebar.date === '7d' ? 7 * DAY_MS : sidebar.date === '30d' ? 30 * DAY_MS : 0;
  const since = sinceWindow ? new Date(now - sinceWindow).toISOString() : undefined;
  const narrowed = isSalaryNarrowed(sidebar);

  const filterParams: JobListFilterParams = {
    locale,
    keyword,
    city: cityFilters.city,
    categories: sidebar.categories,
    locations: cityFilters.queryLocations,
    contractTypes: sidebar.contractTypes,
    ...(narrowed ? { salaryMin: sidebar.salaryMin } : {}),
    ...(narrowed && sidebar.salaryMax < SALARY_MAX_BOUND ? { salaryMax: sidebar.salaryMax } : {}),
    ...(sidebar.accommodation.length === 1 ? { accommodation: sidebar.accommodation.includes('provided') } : {}),
    ...(sidebar.immediate ? { immediate: true } : {}),
    ...(sidebar.noLanguageRequired ? { noLanguageRequired: true } : {}),
    ...(since ? { since } : {}),
  };

  return { keyword, city, sort, sidebar, cityFilters, filterParams };
}

/**
 * Filtry zapisanego wyszukiwania (wersja 1) — klucze = kanoniczna postać w bazie
 * (`saved_search_canonical_filters`, 0093). Świeżość (`date`) pomijamy: alert i tak
 * wybiera wyłącznie oferty nowsze niż watermark.
 */
export interface SavedSearchFilters {
  keyword?: string;
  city?: string;
  categories?: string[];
  locations?: string[];
  contractTypes?: string[];
  salaryMin?: number;
  salaryMax?: number;
  accommodation?: boolean;
  immediate?: true;
  noLanguage?: true;
}

export function savedSearchFiltersFromQuery(query: JobListQuery): SavedSearchFilters {
  const p = query.filterParams;
  const out: SavedSearchFilters = {};
  if (p.keyword) out.keyword = p.keyword;
  if (p.city) out.city = p.city;
  if (p.categories?.length) out.categories = [...p.categories];
  if (p.locations?.length) out.locations = [...p.locations];
  if (p.contractTypes?.length) out.contractTypes = [...p.contractTypes];
  if (p.salaryMin !== undefined) out.salaryMin = p.salaryMin;
  if (p.salaryMax !== undefined) out.salaryMax = p.salaryMax;
  if (p.accommodation !== undefined) out.accommodation = p.accommodation;
  if (p.immediate) out.immediate = true;
  if (p.noLanguageRequired) out.noLanguage = true;
  return out;
}

/** Adres listy (query string z `?`) do ponownego otwarcia wyszukiwania — bez daty i strony. */
export function savedSearchQueryString(query: JobListQuery): string {
  const params: Record<string, string> = { ...sidebarFiltersToParams(query.sidebar) };
  delete params['date'];
  if (query.keyword) params['keyword'] = query.keyword;
  if (query.city) params['city'] = query.city;
  const qs = new URLSearchParams(params).toString();
  return qs ? `?${qs}` : '';
}

/** Czy wyszukiwanie ma choć jeden filtr (puste = wszystkie oferty — nie zapisujemy). */
export function hasSavedSearchFilters(filters: SavedSearchFilters): boolean {
  return Object.keys(filters).length > 0;
}
