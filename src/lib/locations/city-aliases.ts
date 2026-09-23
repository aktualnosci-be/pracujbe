import type { LocationKey } from '@/lib/jobs';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Stabilny identyfikator miasta ↔ jego nazwy we wszystkich językach (#189).
 *
 * `jobs.city` przechowuje jedną nazwę wpisaną przy ofercie (np. „Brussels” albo „Bruxelles”),
 * a interfejs pokazuje nazwę w języku strony. Filtr po mieście, liczniki huba i landing
 * miasta porównują więc ofertę z KOMPLETEM nazw jednego klucza (`brussels` → Bruksela, Brussel,
 * Bruxelles, Brussels), a przetłumaczona nazwa służy wyłącznie prezentacji. Dzięki temu zmiana
 * języka nie zmienia zbioru ofert.
 *
 * Kontrolowana tabela aliasów = istniejące tłumaczenia `locations.*` (bez osobnej listy do
 * utrzymania). Nie zgadujemy po fragmencie ani wielkości liter: wartość z adresu, oferty i
 * facety łączymy wyłącznie po DOKŁADNYM aliasie — tą samą regułą co SQL
 * (`j.city = any(p_locations)`), więc licznik zawsze zgadza się z listą. Nierozpoznana nazwa
 * zostaje osobną wartością.
 * Moduł serwerowy (importuje pliki tłumaczeń).
 */

type LocationNames = Record<LocationKey, string>;

const NAMES_BY_LOCALE: Record<string, LocationNames> = {
  pl: pl.locations,
  nl: nl.locations,
  fr: fr.locations,
  en: en.locations,
};

export const LOCATION_KEYS = Object.keys(pl.locations) as LocationKey[];

const KEY_BY_ALIAS = new Map<string, LocationKey>();
for (const key of LOCATION_KEYS) {
  for (const names of Object.values(NAMES_BY_LOCALE)) KEY_BY_ALIAS.set(names[key], key);
}

/** Klucz miasta dla dokładnej nazwy w dowolnym obsługiwanym języku; `null` gdy nieznana. */
export function resolveLocationKey(value: string): LocationKey | null {
  return KEY_BY_ALIAS.get(value.trim()) ?? null;
}

/** Wszystkie nazwy miasta (PL/NL/FR/EN), bez duplikatów — wartości porównywane z `jobs.city`. */
export function cityAliases(key: LocationKey): string[] {
  return [...new Set(Object.values(NAMES_BY_LOCALE).map((names) => names[key]))];
}

/** Nazwa miasta w języku strony (prezentacja). */
export function localizedCityName(key: LocationKey, locale: string): string {
  return (NAMES_BY_LOCALE[locale] ?? NAMES_BY_LOCALE['pl']!)[key];
}

/** Nazwa lokalizacji do wyświetlenia: rozpoznane miasto w języku strony, inne bez zmian. */
export function localizedLocationLabel(value: string, locale: string): string {
  const key = resolveLocationKey(value);
  return key ? localizedCityName(key, locale) : value;
}

/** Rozpoznane miasta → nazwa w języku strony; nierozpoznane bez zmian. Bez duplikatów. */
export function localizeLocations(values: readonly string[], locale: string): string[] {
  return [...new Set(values.map((value) => localizedLocationLabel(value, locale)))];
}

/** Wartości filtra `p_locations`: rozpoznane miasta → wszystkie aliasy; nierozpoznane bez zmian. */
export function expandLocationAliases(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const key = resolveLocationKey(value);
        return key ? cityAliases(key) : [value];
      }),
    ),
  ];
}

/**
 * Scala facety lokalizacji po kluczu miasta: warianty nazw jednego miasta dają jedną pozycję
 * z nazwą w języku strony i sumą ofert. Nierozpoznane nazwy zostają osobnymi pozycjami.
 */
export function mergeLocationFacets(
  facets: ReadonlyArray<{ city: string; count: number }>,
  locale: string,
): Array<{ city: string; count: number }> {
  const merged = new Map<string, number>();
  for (const { city, count } of facets) {
    const key = resolveLocationKey(city);
    const name = key ? localizedCityName(key, locale) : city;
    merged.set(name, (merged.get(name) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

/** Liczba ofert per klucz miasta z facetów lokalizacji (dokładne dopasowanie aliasu). */
export function countByLocationKey(
  facets: ReadonlyArray<{ city: string; count: number }>,
  keys: readonly LocationKey[],
): Record<LocationKey, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<LocationKey, number>;
  for (const { city, count } of facets) {
    const key = resolveLocationKey(city);
    if (key && key in counts) counts[key] += count;
  }
  return counts;
}

/**
 * Jedna reguła dla listy ofert i podglądu facetów. Parametry adresu zostają bez zmian (linki,
 * formularz GET, przełącznik języka), zmienia się tylko ich znaczenie w zapytaniu:
 * - `location` → wszystkie aliasy rozpoznanych miast (`queryLocations`),
 * - `city` rozpoznany jako miasto → dokładne aliasy zamiast `ILIKE` po nazwie z innego języka;
 *   razem z `location` działa jak dotąd (oba warunki), czyli część wspólna aliasów,
 * - nierozpoznany `city` zostaje wyszukiwaniem tekstowym.
 * `displayLocations` / `cityLabel` to nazwy w języku strony (sidebar, chipy).
 */
export function resolveCityFilters(
  input: { city?: string; locations: readonly string[] },
  locale: string,
): {
  city?: string;
  queryLocations: string[];
  cityKey: LocationKey | null;
  cityLabel?: string;
  displayLocations: string[];
  /** Sam warunek miasta (bez sidebara) — dla zbioru, z którego liczone są facety demo. */
  cityQuery: { city?: string; locations?: string[] };
} {
  const cityKey = input.city ? resolveLocationKey(input.city) : null;
  const expanded = expandLocationAliases(input.locations);
  const display = {
    cityKey,
    cityQuery: cityKey
      ? { locations: cityAliases(cityKey) }
      : input.city
        ? { city: input.city }
        : {},
    displayLocations: localizeLocations(input.locations, locale),
    ...(input.city
      ? { cityLabel: cityKey ? localizedCityName(cityKey, locale) : input.city }
      : {}),
  };
  if (!cityKey) {
    return { ...display, ...(input.city ? { city: input.city } : {}), queryLocations: expanded };
  }
  const aliases = cityAliases(cityKey);
  if (expanded.length === 0) return { ...display, queryLocations: aliases };
  const both = expanded.filter((value) => aliases.includes(value));
  // Rozłączne miasta: zostawiamy dawne zapytanie (tekst + lista) — wynik pusty jak wcześniej.
  return both.length > 0
    ? { ...display, queryLocations: both }
    : { ...display, city: input.city, queryLocations: expanded };
}

/**
 * Facet lokalizacji z bazy w języku strony: warianty jednego miasta scalone, a przy `city`
 * rozpoznanym jako miasto tylko jego warianty (jak dawny `ILIKE` zawężał zbiór bazowy).
 */
export function localizeLocationFacets(
  facets: ReadonlyArray<{ city: string; count: number }>,
  cityKey: LocationKey | null,
  locale: string,
): Array<{ city: string; count: number }> {
  const relevant = cityKey
    ? facets.filter(({ city }) => resolveLocationKey(city) === cityKey)
    : facets;
  return mergeLocationFacets(relevant, locale);
}
