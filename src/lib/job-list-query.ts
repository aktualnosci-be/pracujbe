import type { GetJobsParams } from '@/lib/jobs';
import { resolveCityFilters } from '@/lib/locations/city-aliases';
import { codePointLength, truncateCodePoints } from '@/lib/validation/text';
import type { LanguageCode } from '@/lib/languages';
import type { LanguageFilterLevel, RadiusKm, WorkTimeFilter } from '@/lib/job-filter-options';
import type { ShiftPattern } from '@/lib/job-shift-patterns';
import {
  parseSidebarFilters,
  parseSort,
  refinementQueryParams,
  salaryQueryParams,
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

  const filterParams: JobListFilterParams = {
    locale,
    keyword,
    city: cityFilters.city,
    categories: sidebar.categories,
    locations: cityFilters.queryLocations,
    contractTypes: sidebar.contractTypes,
    // Jednostka widełek (#188, 0091) — ta sama funkcja co lista; steruje też sortowaniem.
    ...salaryQueryParams(sidebar),
    ...(sidebar.accommodation.length === 1 ? { accommodation: sidebar.accommodation.includes('provided') } : {}),
    ...(sidebar.immediate ? { immediate: true } : {}),
    ...(sidebar.noLanguageRequired ? { noLanguageRequired: true } : {}),
    // 0167: filtr „bezpośrednio od pracodawcy”. Zapisane wyszukiwania go nie przechowują
    // (etap 2) — `savedSearchFiltersFromQuery` i adres wyszukiwania go pomijają.
    ...(sidebar.directOnly ? { directOnly: true } : {}),
    // 0194: język + poziom (#786), wymiar pracy (#811), promień (#824) — zapisywane też
    // w wyszukiwaniu (klucze `language`, `languageLevel`, `workTime`, `near`, `radiusKm`).
    ...refinementQueryParams(sidebar),
    ...(since ? { since } : {}),
  };

  return { keyword, city, sort, sidebar, cityFilters, filterParams };
}

/**
 * Filtry zapisanego wyszukiwania (wersja 1) — klucze = kanoniczna postać w bazie
 * (`saved_search_canonical_filters`, 0092). Świeżość (`date`) pomijamy: alert i tak
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
  /** Tylko `hour` i tylko przy widełkach — `month` to domyślna jednostka (0091). */
  salaryUnit?: 'hour';
  accommodation?: boolean;
  immediate?: true;
  noLanguage?: true;
  /** #786 (0194): kod wymaganego języka. */
  language?: LanguageCode;
  /** #786: poziom kandydata (tylko z językiem). */
  languageLevel?: LanguageFilterLevel;
  /** #811 (0194): wymiar pracy. */
  workTime?: WorkTimeFilter;
  /** #858 (0975): typy grafiku pracy (baza zapisuje posortowane, bez duplikatów). */
  shiftPatterns?: ShiftPattern[];
  /** #824 (0194): miejscowość środka promienia (baza zapisuje małymi literami). */
  near?: string;
  /** #824: promień w km (zawsze z `near`). */
  radiusKm?: RadiusKm;
}

/** Limit długości słowa kluczowego i miasta w bazie (`get_public_jobs` ucina, zapis odrzuca dłuższe). */
export const SAVED_SEARCH_TEXT_MAX = 100;

export function savedSearchFiltersFromQuery(query: JobListQuery): SavedSearchFilters {
  const p = query.filterParams;
  const out: SavedSearchFilters = {};
  // Lista ucina słowo kluczowe i miasto do 100 znaków (`left(…, 100)` w `get_public_jobs`,
  // 0026), a zapis odrzuca dłuższe (0092) — ta sama ucięta wartość = ten sam zbiór ofert,
  // więc kandydat może zapisać wyszukiwanie, które lista normalnie obsługuje (#1108).
  const keyword = p.keyword ? truncateCodePoints(p.keyword, SAVED_SEARCH_TEXT_MAX).trim() : '';
  const city = p.city ? truncateCodePoints(p.city, SAVED_SEARCH_TEXT_MAX).trim() : '';
  if (keyword) out.keyword = keyword;
  if (city) out.city = city;
  if (p.categories?.length) out.categories = [...p.categories];
  if (p.locations?.length) out.locations = [...p.locations];
  if (p.contractTypes?.length) out.contractTypes = [...p.contractTypes];
  if (p.salaryMin !== undefined) out.salaryMin = p.salaryMin;
  if (p.salaryMax !== undefined) out.salaryMax = p.salaryMax;
  // Jednostka ma znaczenie wyłącznie dla widełek (sortowanie alertu jest zawsze „najnowsze”).
  if (p.salaryUnit === 'hour' && (p.salaryMin !== undefined || p.salaryMax !== undefined)) {
    out.salaryUnit = 'hour';
  }
  if (p.accommodation !== undefined) out.accommodation = p.accommodation;
  if (p.immediate) out.immediate = true;
  if (p.noLanguageRequired) out.noLanguage = true;
  if (p.language) {
    out.language = p.language;
    if (p.languageLevel) out.languageLevel = p.languageLevel;
  }
  if (p.workTime) out.workTime = p.workTime;
  if (p.shiftPatterns?.length) out.shiftPatterns = [...p.shiftPatterns];
  if (p.near) {
    out.near = p.near;
    if (p.radiusKm !== undefined) out.radiusKm = p.radiusKm;
  }
  return out;
}

/** Adres listy (query string z `?`) do ponownego otwarcia wyszukiwania — bez daty i strony. */
export function savedSearchQueryString(query: JobListQuery): string {
  const params: Record<string, string> = { ...sidebarFiltersToParams(query.sidebar) };
  delete params['date'];
  // 0167: filtr „bezpośrednio od pracodawcy” nie jest częścią zapisanego wyszukiwania (etap 2).
  delete params['direct'];
  // Ta sama ucięta wartość co w filtrach (`savedSearchFiltersFromQuery`): lista i tak ucina do
  // 100 znaków, więc adres prowadzi do tego samego zbioru ofert, a nie przekracza limitu 2000
  // znaków adresu w bazie przy bardzo długim słowie (#1108).
  const keyword = query.keyword ? truncateCodePoints(query.keyword, SAVED_SEARCH_TEXT_MAX).trim() : '';
  const city = query.city ? truncateCodePoints(query.city, SAVED_SEARCH_TEXT_MAX).trim() : '';
  if (keyword) params['keyword'] = keyword;
  if (city) params['city'] = city;
  const qs = new URLSearchParams(params).toString();
  return qs ? `?${qs}` : '';
}

/** Limity zapisu w bazie (0092): lista ≤ 50 pozycji, kategoria/umowa ≤ 50 znaków, miasto ≤ 100, adres ≤ 2000. */
export const SAVED_SEARCH_LIST_MAX = 50;
export const SAVED_SEARCH_QUERY_MAX = 2000;
const SAVED_SEARCH_ENUM_MAX = 50;

/**
 * Czy wyszukiwanie mieści się w limitach zapisu (`save_saved_search`, 0092). Lista ofert
 * obsługuje dowolnie wiele lokalizacji (np. kilkanaście miast rozwiniętych do wszystkich nazw)
 * i dowolnie długi adres, a baza ich nie przyjmie — zamiast ogólnego błędu po kliknięciu
 * „Zapisz” lista od razu mówi, że trzeba zawęzić filtry (#1108). Liczymy jak `char_length`
 * (punkty kodowe).
 */
export function savedSearchExceedsLimits(filters: SavedSearchFilters, query: string): boolean {
  const lists: Array<[readonly string[] | undefined, number]> = [
    [filters.categories, SAVED_SEARCH_ENUM_MAX],
    [filters.contractTypes, SAVED_SEARCH_ENUM_MAX],
    [filters.locations, SAVED_SEARCH_TEXT_MAX],
  ];
  for (const [list, max] of lists) {
    if (!list) continue;
    if (list.length > SAVED_SEARCH_LIST_MAX) return true;
    if (list.some((value) => codePointLength(value.trim()) > max)) return true;
  }
  return codePointLength(query) > SAVED_SEARCH_QUERY_MAX;
}

/** Czy wyszukiwanie ma choć jeden filtr (puste = wszystkie oferty — nie zapisujemy). */
export function hasSavedSearchFilters(filters: SavedSearchFilters): boolean {
  return Object.keys(filters).length > 0;
}
