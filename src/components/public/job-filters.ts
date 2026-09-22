/**
 * Wspólna logika filtrowania ofert (Pracuj.be) — moduł czysty (bez React, bez „use client”),
 * dzięki czemu może być importowany zarówno przez komponent serwerowy (strona listy ofert,
 * właściwe filtrowanie wyników) jak i klienckie panele filtrów (FilterSidebar/FilterSheet,
 * podgląd liczników na żywo). Jedno źródło reguł = spójne wyniki po obu stronach.
 *
 * Zakres: filtry sterowane sidebarem (kategoria, lokalizacja, wynagrodzenie, rodzaj umowy,
 * zakwaterowanie, „od zaraz”, bez wymogu językowego, data dodania). Słowo kluczowe i miasto
 * z górnej wyszukiwarki są zachowywane przy obliczaniu facetów. Produkcyjny listing pobiera
 * dokładne wartości z jednego agregatu SQL; logika tablicowa jest pełnym fallbackiem wyłącznie
 * dla małego zestawu danych demonstracyjnych.
 */

import type { CategoryKey, ContractType, JobListItem } from '@/lib/jobs';
import type { JobFilterFacets } from '@/types/job-filter-facets';

/** Widełki suwaka wynagrodzenia (brutto/mies., EUR). `SALARY_MAX_BOUND` oznacza „i więcej”. */
export const SALARY_MIN_BOUND = 1500;
export const SALARY_MAX_BOUND = 4500;
export const SALARY_STEP = 100;

export type AccommodationValue = 'provided' | 'unavailable';
export type DateValue = 'any' | '24h' | '7d' | '30d';
export type SortValue = 'newest' | 'salary';

/** Stan filtrów sterowanych sidebarem (bez słowa kluczowego / miasta / sortowania). */
export interface SidebarFilters {
  categories: CategoryKey[];
  locations: string[];
  contractTypes: ContractType[];
  salaryMin: number;
  salaryMax: number;
  accommodation: AccommodationValue[];
  immediate: boolean;
  noLanguageRequired: boolean;
  date: DateValue;
}

/** Minimalny, serializowalny rekord oferty do facetingu i podglądu liczników. */
export interface FacetItem {
  category: CategoryKey;
  city: string;
  contractType: ContractType;
  salaryMin?: number;
  salaryMax?: number;
  accommodation: boolean;
  immediate: boolean;
  noLanguageRequired: boolean;
  publishedAt: string;
}

export const CATEGORY_KEYS: readonly CategoryKey[] = [
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

export const CONTRACT_TYPES: readonly ContractType[] = [
  'permanent',
  'temporary',
  'interim',
  'freelance',
  'internship',
  'seasonal',
];

export const ACCOMMODATION_VALUES: readonly AccommodationValue[] = [
  'provided',
  'unavailable',
];
export const DATE_VALUES: readonly DateValue[] = ['any', '24h', '7d', '30d'];
const SORT_VALUES: readonly SortValue[] = ['newest', 'salary'];

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_WINDOW_MS: Record<Exclude<DateValue, 'any'>, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};

export function emptySidebarFilters(): SidebarFilters {
  return {
    categories: [],
    locations: [],
    contractTypes: [],
    salaryMin: SALARY_MIN_BOUND,
    salaryMax: SALARY_MAX_BOUND,
    accommodation: [],
    immediate: false,
    noLanguageRequired: false,
    date: 'any',
  };
}

/** Rozbija wartość CSV z URL na listę niepustych tokenów. */
export function splitParam(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function clampSalary(value: number): number {
  const stepped = Math.round(value / SALARY_STEP) * SALARY_STEP;
  return Math.min(SALARY_MAX_BOUND, Math.max(SALARY_MIN_BOUND, stepped));
}

/** Odczyt filtrów sidebara z płaskiego zestawu parametrów zapytania. */
export function parseSidebarFilters(
  sp: Record<string, string | undefined>,
): SidebarFilters {
  const f = emptySidebarFilters();

  f.categories = splitParam(sp['category']).filter((v): v is CategoryKey =>
    (CATEGORY_KEYS as readonly string[]).includes(v),
  );
  f.locations = splitParam(sp['location']);
  f.contractTypes = splitParam(sp['contractType']).filter(
    (v): v is ContractType => (CONTRACT_TYPES as readonly string[]).includes(v),
  );

  const min = Number(sp['salaryMin']);
  const max = Number(sp['salaryMax']);
  f.salaryMin = Number.isFinite(min) ? clampSalary(min) : SALARY_MIN_BOUND;
  f.salaryMax = Number.isFinite(max) ? clampSalary(max) : SALARY_MAX_BOUND;
  if (f.salaryMin > f.salaryMax) {
    f.salaryMin = SALARY_MIN_BOUND;
    f.salaryMax = SALARY_MAX_BOUND;
  }

  f.accommodation = splitParam(sp['accommodation']).filter(
    (v): v is AccommodationValue =>
      (ACCOMMODATION_VALUES as readonly string[]).includes(v),
  );
  f.immediate = sp['immediate'] === '1';
  f.noLanguageRequired = sp['noLang'] === '1';

  const date = sp['date'];
  f.date = (DATE_VALUES as readonly string[]).includes(date ?? '')
    ? (date as DateValue)
    : 'any';

  return f;
}

export function parseSort(value: string | undefined): SortValue {
  return (SORT_VALUES as readonly string[]).includes(value ?? '')
    ? (value as SortValue)
    : 'newest';
}

/** Czy zakres wynagrodzenia został zawężony względem pełnych widełek. */
export function isSalaryNarrowed(f: SidebarFilters): boolean {
  return f.salaryMin > SALARY_MIN_BOUND || f.salaryMax < SALARY_MAX_BOUND;
}

/** Predykat dopasowania oferty do filtrów sidebara (używany serwerowo i klienckim liczniku). */
export function matchesSidebar(item: FacetItem, f: SidebarFilters): boolean {
  if (f.categories.length > 0 && !f.categories.includes(item.category))
    return false;
  if (f.locations.length > 0 && !f.locations.includes(item.city)) return false;
  if (
    f.contractTypes.length > 0 &&
    !f.contractTypes.includes(item.contractType)
  )
    return false;

  if (isSalaryNarrowed(f)) {
    const maxEff =
      f.salaryMax >= SALARY_MAX_BOUND ? Number.POSITIVE_INFINITY : f.salaryMax;
    const iMin = item.salaryMin ?? item.salaryMax;
    const iMax = item.salaryMax ?? item.salaryMin;
    if (iMin !== undefined && iMax !== undefined) {
      if (iMax < f.salaryMin || iMin > maxEff) return false;
    }
    // Oferty bez podanego wynagrodzenia nie są wykluczane przez filtr widełek.
  }

  if (f.accommodation.length === 1) {
    const wantProvided = f.accommodation.includes('provided');
    if (item.accommodation !== wantProvided) return false;
  }

  if (f.immediate && !item.immediate) return false;
  if (f.noLanguageRequired && !item.noLanguageRequired) return false;

  if (f.date !== 'any') {
    const ts = Date.parse(item.publishedAt);
    if (Number.isNaN(ts)) return false;
    if (Date.now() - ts > DATE_WINDOW_MS[f.date]) return false;
  }

  return true;
}

export function countMatches(
  items: readonly FacetItem[],
  f: SidebarFilters,
): number {
  let count = 0;
  for (const item of items) {
    if (matchesSidebar(item, f)) count += 1;
  }
  return count;
}

/** Pełny fallback wyłącznie dla małego, kompletnego zbioru demonstracyjnego. */
export function buildDemoFacets(
  items: readonly FacetItem[],
  filters: SidebarFilters,
): JobFilterFacets {
  const without = (key: keyof SidebarFilters): SidebarFilters => ({
    ...filters,
    ...(key === 'categories' ? { categories: [] } : {}),
    ...(key === 'locations' ? { locations: [] } : {}),
    ...(key === 'contractTypes' ? { contractTypes: [] } : {}),
    ...(key === 'accommodation' ? { accommodation: [] } : {}),
    ...(key === 'immediate' ? { immediate: false } : {}),
    ...(key === 'noLanguageRequired' ? { noLanguageRequired: false } : {}),
  });
  const grouped = (
    field: 'category' | 'city' | 'contractType',
    own: keyof SidebarFilters,
  ) => {
    const result: Record<string, number> = {};
    for (const item of items)
      if (matchesSidebar(item, without(own))) {
        const value = item[field];
        result[value] = (result[value] ?? 0) + 1;
      }
    return result;
  };
  const accommodationItems = items.filter((item) =>
    matchesSidebar(item, without('accommodation')),
  );
  const locations = Object.entries(grouped('city', 'locations'))
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  return {
    total: countMatches(items, filters),
    categories: grouped('category', 'categories'),
    locations,
    contracts: grouped('contractType', 'contractTypes'),
    accommodation: {
      provided: accommodationItems.filter((item) => item.accommodation).length,
      unavailable: accommodationItems.filter((item) => !item.accommodation)
        .length,
    },
    immediate: items.filter(
      (item) => matchesSidebar(item, without('immediate')) && item.immediate,
    ).length,
    noLanguage: items.filter(
      (item) =>
        matchesSidebar(item, without('noLanguageRequired')) &&
        item.noLanguageRequired,
    ).length,
  };
}

/** Rzutuje pełny element listy na minimalny rekord facetu. */
export function toFacetItem(job: JobListItem): FacetItem {
  return {
    category: job.category,
    city: job.city,
    contractType: job.contractType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    accommodation: job.accommodation,
    immediate: job.immediate,
    noLanguageRequired: job.noLanguageRequired,
    publishedAt: job.publishedAt,
  };
}

/** Serializacja filtrów sidebara do parametrów URL (pomija wartości domyślne). */
export function sidebarFiltersToParams(
  f: SidebarFilters,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.categories.length) params['category'] = f.categories.join(',');
  if (f.locations.length) params['location'] = f.locations.join(',');
  if (f.contractTypes.length)
    params['contractType'] = f.contractTypes.join(',');
  if (isSalaryNarrowed(f)) {
    params['salaryMin'] = String(f.salaryMin);
    params['salaryMax'] = String(f.salaryMax);
  }
  // Zaznaczenie obu opcji zakwaterowania nie zawęża wyników — zapisujemy tylko realne filtry.
  if (f.accommodation.length === 1)
    params['accommodation'] = f.accommodation.join(',');
  if (f.immediate) params['immediate'] = '1';
  if (f.noLanguageRequired) params['noLang'] = '1';
  if (f.date !== 'any') params['date'] = f.date;
  return params;
}

/** Liczba aktywnych wymiarów filtra (na badge „Filtry (n)”). */
export function countActiveSidebar(f: SidebarFilters): number {
  return (
    f.categories.length +
    f.locations.length +
    f.contractTypes.length +
    (isSalaryNarrowed(f) ? 1 : 0) +
    (f.accommodation.length === 1 ? 1 : 0) +
    (f.immediate ? 1 : 0) +
    (f.noLanguageRequired ? 1 : 0) +
    (f.date !== 'any' ? 1 : 0)
  );
}

function salaryKey(job: { salaryMin?: number; salaryMax?: number }): number {
  return job.salaryMax ?? job.salaryMin ?? 0;
}

/** Sortowanie ofert: najnowsze (domyślnie) lub najwyższe wynagrodzenie. */
export function sortJobs<
  T extends { publishedAt: string; salaryMin?: number; salaryMax?: number },
>(jobs: readonly T[], sort: SortValue): T[] {
  const copy = [...jobs];
  if (sort === 'salary') {
    copy.sort(
      (a, b) =>
        salaryKey(b) - salaryKey(a) ||
        b.publishedAt.localeCompare(a.publishedAt),
    );
  } else {
    copy.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  return copy;
}
