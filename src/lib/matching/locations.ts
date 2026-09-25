import { belgianCityCoordinates, cityKey } from '@/lib/matching/belgian-cities';
import type { Coordinates } from '@/lib/matching/score';

/**
 * Współrzędne miejscowości (#194) — bez geokodowania zewnętrznego. Najpierw słownik `locations`
 * z bazy przez aliasy (`location_aliases.alias_key` = `cityKey`, nazwy PL/NL/FR/EN, 0109:
 * lista kanoniczna + gminy Belgii z Wikidata), potem kanoniczna lista w kodzie
 * (`belgian-cities.ts` — lustro części bazy, działa także bez odczytu słownika).
 * Miasto spoza obu = współrzędne nieznane (`undefined`): silnik nie szacuje wtedy odległości.
 */
export type LocationAliasRow = {
  aliasKey: string;
  latitude: number | null;
  longitude: number | null;
};

/** Klucze do zapytania o aliasy: unikalne, niepuste `cityKey` podanych miast. */
export function locationLookupKeys(...cities: (string | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const city of cities) {
    const key = city ? cityKey(city) : '';
    if (key) keys.add(key);
  }
  return [...keys];
}

export function resolveCoordinates(
  city: string | undefined,
  rows: readonly LocationAliasRow[],
): Coordinates | undefined {
  if (!city) return undefined;
  const wanted = cityKey(city);
  if (!wanted) return undefined;
  const row = rows.find((r) => r.aliasKey === wanted && r.latitude != null && r.longitude != null);
  if (row) return { lat: row.latitude!, lng: row.longitude! };
  return belgianCityCoordinates(city);
}
