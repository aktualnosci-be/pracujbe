import { belgianCityCoordinates, cityKey } from '@/lib/matching/belgian-cities';
import type { Coordinates } from '@/lib/matching/score';

/**
 * Współrzędne miejscowości (#194) — bez geokodowania zewnętrznego. Najpierw słownik `locations`
 * z bazy (nazwa albo slug), potem kanoniczna lista belgijskich miast w kodzie
 * (`belgian-cities.ts`, aliasy PL/NL/FR/EN). Porównanie bez wielkości liter i diakrytyków.
 * Miasto spoza obu = współrzędne nieznane (`undefined`): silnik nie szacuje wtedy odległości.
 */
export type LocationRow = {
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
};

export function resolveCoordinates(
  city: string | undefined,
  rows: readonly LocationRow[],
): Coordinates | undefined {
  if (!city) return undefined;
  const wanted = cityKey(city);
  if (!wanted) return undefined;
  for (const row of rows) {
    if (row.latitude == null || row.longitude == null) continue;
    if (cityKey(row.name) === wanted || cityKey(row.slug) === wanted) {
      return { lat: row.latitude, lng: row.longitude };
    }
  }
  return belgianCityCoordinates(city);
}
