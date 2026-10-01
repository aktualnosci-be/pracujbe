import { localizedLocationLabel } from '@/lib/locations/city-aliases';
import { parseJobListQuery, type FlatSearchParams, type JobListQuery } from '@/lib/job-list-query';
import { SHIFT_PATTERN_PARAM } from '@/lib/job-shift-patterns';
import { isSalaryNarrowed, salaryBounds } from '@/components/public/job-filters';

/**
 * Opis aktywnych filtrów listy ofert — jedno źródło etykiet dla chipów `/oferty-pracy`
 * i podsumowania zapisanego wyszukiwania w `/candidate/wyszukiwania` (#100). Etykiety
 * powstają w języku WIDZA z kanonicznego adresu listy, więc zapisane wyszukiwanie pokazuje
 * swoje filtry także po zmianie nazwy i po zmianie języka panelu. Moduł bez I/O.
 */

/** Minimalny kontrakt tłumacza next-intl (`getTranslations` / `useTranslations`). */
export type FilterTranslator = (key: string, values?: Record<string, string | number>) => string;

export interface FilterSummaryTranslators {
  /** Przestrzeń `filters`. */
  filters: FilterTranslator;
  /** Przestrzeń `categories`. */
  categories: FilterTranslator;
  /** Przestrzeń `contractTypes`. */
  contractTypes: FilterTranslator;
  /** Przestrzeń `languageNames` (nazwa języka w języku widza, 0194). */
  languageNames: FilterTranslator;
}

/**
 * Jeden filtr: `removeKey`/`removeValue` mówią, który parametr adresu go ustawia
 * (`salary` = trzy parametry widełek naraz) — lista ofert buduje z tego link „Usuń filtr”.
 */
export interface JobFilterSummaryItem {
  id: string;
  label: string;
  removeKey: string;
  removeValue?: string;
  /** Pozostałe parametry adresu tego filtra, usuwane razem z `removeKey` (np. poziom z językiem). */
  alsoRemove?: string[];
}

export function describeJobListFilters(
  query: JobListQuery,
  locale: string,
  t: FilterSummaryTranslators,
): JobFilterSummaryItem[] {
  const { keyword, city, sidebar: sf, cityFilters } = query;
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });

  const items: JobFilterSummaryItem[] = [];
  if (keyword) items.push({ id: 'kw', label: keyword, removeKey: 'keyword' });
  if (city) items.push({ id: 'city', label: cityFilters.cityLabel ?? city, removeKey: 'city' });
  for (const cat of sf.categories) {
    items.push({ id: `cat-${cat}`, label: t.categories(cat), removeKey: 'category', removeValue: cat });
  }
  for (const loc of sf.locations) {
    items.push({
      id: `loc-${loc}`,
      label: localizedLocationLabel(loc, locale),
      removeKey: 'location',
      removeValue: loc,
    });
  }
  for (const ct of sf.contractTypes) {
    items.push({ id: `ct-${ct}`, label: t.contractTypes(ct), removeKey: 'contractType', removeValue: ct });
  }
  if (isSalaryNarrowed(sf)) {
    const maxLabel =
      sf.salaryMax >= salaryBounds(sf.salaryUnit).max
        ? t.filters('salaryMaxCap', { value: currency.format(sf.salaryMax) })
        : currency.format(sf.salaryMax);
    items.push({
      id: 'salary',
      label: t.filters(sf.salaryUnit === 'hour' ? 'salaryChipHourly' : 'salaryChip', {
        min: currency.format(sf.salaryMin),
        max: maxLabel,
      }),
      removeKey: 'salary',
    });
  }
  if (sf.accommodation.length === 1) {
    const value = sf.accommodation.includes('provided') ? 'provided' : 'unavailable';
    items.push({ id: 'acc', label: t.filters(value), removeKey: 'accommodation' });
  }
  if (sf.immediate) items.push({ id: 'immediate', label: t.filters('immediate'), removeKey: 'immediate' });
  if (sf.noLanguageRequired) {
    items.push({ id: 'nolang', label: t.filters('noLanguageRequired'), removeKey: 'noLang' });
  }
  if (sf.language) {
    const language = t.languageNames(sf.language);
    items.push({
      id: 'lang',
      label: sf.languageLevel
        ? t.filters('languageLevelChip', { language, level: t.filters(`languageLevels.${sf.languageLevel}`) })
        : t.filters('languageChip', { language }),
      removeKey: 'lang',
      alsoRemove: ['langLevel'],
    });
  }
  if (sf.workTime) {
    items.push({
      id: 'worktime',
      label: t.filters(sf.workTime === 'full_time' ? 'workTimeFull' : 'workTimePart'),
      removeKey: 'workTime',
    });
  }
  // 0975 (#858): typy grafiku pracy — chip na wartość (jak rodzaj umowy).
  for (const pattern of sf.shiftPatterns) {
    items.push({
      id: `shift-${pattern}`,
      label: t.filters(`shiftPatternValues.${pattern}`),
      removeKey: SHIFT_PATTERN_PARAM,
      removeValue: pattern,
    });
  }
  if (sf.near) {
    items.push({
      id: 'near',
      label: t.filters('radiusChip', { km: sf.radiusKm, place: sf.near }),
      removeKey: 'near',
      alsoRemove: ['radius'],
    });
  }
  if (sf.date !== 'any') {
    const key = sf.date === '24h' ? 'date24h' : sf.date === '7d' ? 'date7d' : 'date30d';
    items.push({ id: 'date', label: t.filters(key), removeKey: 'date' });
  }
  return items;
}

/**
 * Etykiety filtrów zapisanego wyszukiwania z jego adresu listy (`saved_searches.query`,
 * zawsze `?…` albo pusty). Świeżość (`date`) nie należy do zapisanych filtrów (alert i tak
 * bierze tylko nowe oferty), więc jej nie pokazujemy. Pusty/nieznany adres = brak etykiet.
 */
export function savedSearchFilterLabels(
  queryString: string,
  locale: string,
  t: FilterSummaryTranslators,
): string[] {
  if (!queryString.startsWith('?')) return [];
  const flat: FlatSearchParams = {};
  for (const [key, value] of new URLSearchParams(queryString.slice(1))) {
    if (flat[key] === undefined) flat[key] = value;
  }
  return describeJobListFilters(parseJobListQuery(flat, locale), locale, t)
    .filter((item) => item.id !== 'date')
    .map((item) => item.label);
}
