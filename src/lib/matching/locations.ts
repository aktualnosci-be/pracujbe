import type { Coordinates } from '@/lib/matching/score';

/**
 * Współrzędne miejscowości ze słownika `locations` (#194) — bez geokodowania zewnętrznego.
 * Dopasowanie po nazwie albo slugu (bez wielkości liter i znaków diakrytycznych).
 * Miasto spoza słownika = współrzędne nieznane (`undefined`): silnik nie szacuje wtedy odległości.
 */
export type LocationRow = {
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
};

function key(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

export function resolveCoordinates(
  city: string | undefined,
  rows: readonly LocationRow[],
): Coordinates | undefined {
  if (!city) return undefined;
  const wanted = key(city);
  if (!wanted) return undefined;
  for (const row of rows) {
    if (row.latitude == null || row.longitude == null) continue;
    if (key(row.name) === wanted || key(row.slug) === wanted) {
      return { lat: row.latitude, lng: row.longitude };
    }
  }
  return undefined;
}
