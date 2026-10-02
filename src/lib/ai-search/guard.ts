import { containsAiInstructions } from '@/lib/ai-assist/guard';
import {
  ALL_SENSITIVE_KINDS,
  findSensitiveData,
  redactSensitiveData,
  REDACTION_MARKERS,
} from '@/lib/privacy/sensitive-data';
import { searchFold } from '@/lib/search-fold';
import {
  LOCATION_KEYS,
  localizedCityName,
  resolveLocationKey,
} from '@/lib/locations/city-aliases';
import { truncateCodePoints } from '@/lib/validation/text';
import {
  CATEGORY_KEYS,
  CONTRACT_TYPES,
  parseSidebarFilters,
  salaryBounds,
  serializeLocations,
  sidebarFiltersToParams,
} from '@/components/public/job-filters';
import type { LocationKey } from '@/lib/jobs';
import {
  ACCOMMODATION_CHOICES,
  SALARY_UNITS,
  SEARCH_ASSIST_LIMITS,
  WORK_TIME_CHOICES,
  type SearchAssistRequest,
  type SearchAssistResponse,
} from '@/lib/ai-search/schema';

/**
 * Deterministyczne bramki wyszukiwania opisem (#711) — działają niezależnie od instrukcji dla
 * modelu:
 *   - przed wysłaniem: polecenia dla AI (prompt injection) = brak wywołania modelu; e-maile,
 *     telefony i numery identyfikacyjne zastąpione znacznikiem (dane osobowe nie idą do dostawcy);
 *   - po odpowiedzi: tylko wartości istniejących słowników listy ofert, słowo kluczowe
 *     i fragmenty pokazywane użytkownikowi WYŁĄCZNIE z jego własnego tekstu, kwoty w zakresie
 *     suwaka; wynik przechodzi przez parser listy (`parseSidebarFilters` → `sidebarFiltersToParams`),
 *     więc parametry są dokładnie tymi, które lista sama by zapisała.
 */

const TAG = /<\s*\/?\s*search_text\b/i;

export function detectSearchInjection(text: string): boolean {
  return containsAiInstructions(text) || TAG.test(text);
}

/** Redakcja danych kontaktowych i identyfikatorów przed wysłaniem do dostawcy. */
export function redactSearchText(text: string): string {
  return redactSensitiveData(text, ALL_SENSITIVE_KINDS).text;
}

const MARKERS = Object.values(REDACTION_MARKERS);

function hasSensitive(text: string): boolean {
  return MARKERS.some((m) => text.includes(m)) || findSensitiveData(text, ALL_SENSITIVE_KINDS).length > 0;
}

/** Czyści znaki sterujące i niewidoczne znaki kierunku tekstu. */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Czy `fragment` występuje w tekście użytkownika (bez wielkości liter i znaków diakrytycznych). */
export function isFromUserText(fragment: string, userText: string): boolean {
  const f = searchFold(clean(fragment));
  return f.length > 0 && searchFold(clean(userText)).includes(f);
}

export interface MappedSearch {
  /** Kanoniczne parametry listy ofert. */
  params: Record<string, string>;
  places: string[];
  uncertain: string[];
  droppedCount: number;
}

function pickEnum<T extends string>(values: readonly string[], allowed: readonly T[], dropped: { n: number }): T[] {
  const out: T[] = [];
  for (const value of values) {
    if ((allowed as readonly string[]).includes(value)) {
      if (!out.includes(value as T)) out.push(value as T);
    } else dropped.n += 1;
  }
  return out;
}

function pickFragments(values: readonly string[], userText: string, dropped: { n: number }): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    if (
      value.length > SEARCH_ASSIST_LIMITS.fragment ||
      hasSensitive(value) ||
      !isFromUserText(value, userText)
    ) {
      dropped.n += 1;
      continue;
    }
    if (!out.some((v) => searchFold(v) === searchFold(value))) out.push(value);
  }
  return out.slice(0, SEARCH_ASSIST_LIMITS.fragments);
}

/**
 * Odpowiedź modelu → kanoniczne parametry listy. `sentText` = tekst po redakcji (ten, który
 * widział model) — tylko z niego mogą pochodzić słowo kluczowe i fragmenty.
 */
export function mapSearchResponse(
  request: SearchAssistRequest,
  sentText: string,
  response: SearchAssistResponse,
): MappedSearch {
  const dropped = { n: 0 };

  const categories = pickEnum(response.categories, CATEGORY_KEYS, dropped);
  const locationKeys: LocationKey[] = pickEnum(response.locations, LOCATION_KEYS, dropped);
  const contractTypes = pickEnum(response.contractTypes, CONTRACT_TYPES, dropped);

  // Miejscowości: znana nazwa (w dowolnym języku) trafia do filtra lokalizacji; reszta czeka na
  // wybór użytkownika — nie zgadujemy.
  const places: string[] = [];
  for (const place of pickFragments(response.unresolvedPlaces, sentText, dropped)) {
    const key = resolveLocationKey(place);
    if (key) {
      if (!locationKeys.includes(key)) locationKeys.push(key);
    } else places.push(place);
  }

  const flat: Record<string, string | undefined> = {};
  if (categories.length) flat['category'] = categories.join(',');
  if (locationKeys.length) {
    flat['location'] = serializeLocations(locationKeys.map((key) => localizedCityName(key, request.locale)));
  }
  if (contractTypes.length) flat['contractType'] = contractTypes.join(',');

  const unit = (SALARY_UNITS as readonly string[]).includes(response.salaryUnit)
    ? (response.salaryUnit as (typeof SALARY_UNITS)[number])
    : null;
  if (!unit) dropped.n += 1;
  const bounds = salaryBounds(unit ?? 'month');
  const validAmount = (n: number) => Number.isInteger(n) && n > 0;
  const min = validAmount(response.salaryMin) ? response.salaryMin : 0;
  const max = validAmount(response.salaryMax) ? response.salaryMax : 0;
  // Kwota spoza zakresu suwaka danej jednostki = zła jednostka albo zmyślona liczba — pomijamy.
  const inRange = (n: number) => n >= bounds.min && n <= bounds.max * 2;
  if (unit && (min || max)) {
    if ((min && !inRange(min)) || (max && !inRange(max)) || (min && max && min > max)) {
      dropped.n += 1;
    } else {
      // Liczba musi pojawić się w tekście użytkownika (model nie dopisuje kwot).
      const digits = sentText.replace(/[\s., ]/g, '');
      const mentioned = (n: number) => !n || digits.includes(String(n));
      if (mentioned(min) && mentioned(max)) {
        flat['salaryUnit'] = unit;
        flat['salaryMin'] = String(min || bounds.min);
        flat['salaryMax'] = String(max ? Math.min(max, bounds.max) : bounds.max);
      } else dropped.n += 1;
    }
  }

  if ((ACCOMMODATION_CHOICES as readonly string[]).includes(response.accommodation)) {
    if (response.accommodation !== 'any') flat['accommodation'] = response.accommodation;
  } else dropped.n += 1;
  if (response.immediate) flat['immediate'] = '1';
  if (response.noLanguageRequired) flat['noLang'] = '1';
  if ((WORK_TIME_CHOICES as readonly string[]).includes(response.workTime)) {
    if (response.workTime !== 'any') flat['workTime'] = response.workTime;
  } else dropped.n += 1;

  // Parser listy = jedyne źródło kanonicznych parametrów (zakresy, domyślne wartości, kolejność).
  const params = sidebarFiltersToParams(parseSidebarFilters(flat));

  const keyword = clean(response.keyword);
  if (keyword) {
    if (
      keyword.length <= SEARCH_ASSIST_LIMITS.keyword &&
      !hasSensitive(keyword) &&
      isFromUserText(keyword, sentText)
    ) {
      params['keyword'] = truncateCodePoints(keyword, SEARCH_ASSIST_LIMITS.keyword).trim();
    } else dropped.n += 1;
  }

  const uncertain = pickFragments(response.uncertain, sentText, dropped);
  return { params, places, uncertain, droppedCount: dropped.n };
}
