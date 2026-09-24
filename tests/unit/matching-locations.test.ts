import { describe, expect, it } from 'vitest';

import { resolveCoordinates, type LocationRow } from '@/lib/matching/locations';

/** #194: współrzędne tylko ze słownika — miasto spoza niego to brak danych, nie szacunek. */
const ROWS: LocationRow[] = [
  { name: 'Liège', slug: 'liege', latitude: 50.6326, longitude: 5.5797 },
  { name: 'Ghent', slug: 'ghent', latitude: 51.0541, longitude: 3.7172 },
  { name: 'Nowhere', slug: 'nowhere', latitude: null, longitude: null },
];

describe('resolveCoordinates', () => {
  it('dopasowuje nazwę lub slug bez wielkości liter i diakrytyków', () => {
    expect(resolveCoordinates('liege', ROWS)).toEqual({ lat: 50.6326, lng: 5.5797 });
    expect(resolveCoordinates(' LIÈGE ', ROWS)).toEqual({ lat: 50.6326, lng: 5.5797 });
    expect(resolveCoordinates('Ghent', ROWS)).toEqual({ lat: 51.0541, lng: 3.7172 });
  });

  it('miasto spoza słownika, bez współrzędnych albo puste → undefined (kontrola ujemna)', () => {
    expect(resolveCoordinates('Gent', ROWS)).toBeUndefined();
    expect(resolveCoordinates('Nowhere', ROWS)).toBeUndefined();
    expect(resolveCoordinates('', ROWS)).toBeUndefined();
    expect(resolveCoordinates(undefined, ROWS)).toBeUndefined();
  });
});
