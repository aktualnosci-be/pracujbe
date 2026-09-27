import { describe, expect, it } from 'vitest';

import {
  parseLocationsParam,
  parseSidebarFilters,
  serializeLocations,
  sidebarFiltersToParams,
} from '@/components/public/job-filters';

/**
 * #845 — miasto z wolnego tekstu kreatora (`jobs.city`) może samo zawierać przecinek, np.
 * „Bruxelles, Belgique”. `parseLocationsParam`/`serializeLocations` escapują przecinek (i
 * backslash) wewnątrz KAŻDEJ nazwy, więc jedna wybrana opcja filtra nie rozpada się na dwie
 * wartości i nie gubi oferty, dla której się pojawiła.
 */
describe('lokalizacja z przecinkiem w nazwie (#845)', () => {
  it('serializuje i odczytuje pojedyncze miasto z przecinkiem jako jedną wartość', () => {
    const serialized = serializeLocations(['Bruxelles, Belgique']);
    expect(serialized).toBe('Bruxelles\\, Belgique');
    expect(parseLocationsParam(serialized)).toEqual(['Bruxelles, Belgique']);
  });

  it('round-trip przez URLSearchParams (encode/decode) zachowuje jedną wartość', () => {
    const serialized = serializeLocations(['Bruxelles, Belgique']);
    const params = new URLSearchParams({ location: serialized });
    const url = new URL(`https://pracuj.be/oferty-pracy?${params.toString()}`);
    const decoded = url.searchParams.get('location') ?? undefined;
    expect(parseLocationsParam(decoded)).toEqual(['Bruxelles, Belgique']);
  });

  it('parseSidebarFilters odczytuje escapowaną, pojedynczą lokalizację z przecinkiem', () => {
    const filters = parseSidebarFilters({ location: serializeLocations(['Bruxelles, Belgique']) });
    expect(filters.locations).toEqual(['Bruxelles, Belgique']);
  });

  it('sidebarFiltersToParams → parseSidebarFilters to tożsamość dla wielu miast, w tym z przecinkiem', () => {
    const filters = parseSidebarFilters({});
    filters.locations = ['Bruxelles, Belgique', 'Antwerpen', 'Comma, Town, Multi'];
    const params = sidebarFiltersToParams(filters);
    const roundTripped = parseSidebarFilters(params);
    expect(roundTripped.locations).toEqual(filters.locations);
  });

  it('backslash dosłowny w nazwie też przechodzi round-trip', () => {
    const serialized = serializeLocations(['A\\B, C']);
    expect(parseLocationsParam(serialized)).toEqual(['A\\B, C']);
  });

  it('kontrola ujemna: bez escapingu przecinek rozbija jedną nazwę na dwie wartości', () => {
    // Dokładnie zachowanie SPRZED #845 (`value.split(',')` bez rozróżnienia backslasha) —
    // dowodzi, że sam scenariusz jest realny, a nie tylko teoretyczny.
    const naiveSplit = (value: string): string[] =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    expect(naiveSplit('Bruxelles, Belgique')).toEqual(['Bruxelles', 'Belgique']);
    expect(naiveSplit('Bruxelles, Belgique')).not.toEqual(['Bruxelles, Belgique']);
  });

  it('zgodność wstecz: stary adres wielu miast bez backslashy parsuje się jak dawny CSV', () => {
    expect(parseLocationsParam('Brussels,Antwerp')).toEqual(['Brussels', 'Antwerp']);
    expect(parseLocationsParam('Brussels, Antwerp')).toEqual(['Brussels', 'Antwerp']);
  });

  it('pusta wartość daje pustą listę', () => {
    expect(parseLocationsParam(undefined)).toEqual([]);
    expect(parseLocationsParam('')).toEqual([]);
  });
});
