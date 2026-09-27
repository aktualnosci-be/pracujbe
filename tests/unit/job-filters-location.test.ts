import { describe, expect, it } from 'vitest';

import {
  emptySidebarFilters,
  joinLocationsParam,
  parseLocationsParam,
  parseSidebarFilters,
  sidebarFiltersToParams,
} from '@/components/public/job-filters';

/**
 * #845 — nazwa miasta (wolny tekst) może zawierać przecinek, np. „Bruxelles, Belgique”.
 * Zwykłe CSV (`join(',')`/`split(',')`) nie odróżnia wtedy przecinka wewnątrz jednej nazwy
 * od separatora listy: zaznaczenie tej JEDNEJ opcji filtra po przejściu przez URL rozpada się
 * na dwie lokalizacje i gubi ofertę, dla której opcja się pojawiła.
 */
describe('lokalizacje filtra listy ofert — escapowanie przecinka (#845)', () => {
  it('zachowuje jedną nazwę z przecinkiem po pełnym roundtripie URL', () => {
    const filters = { ...emptySidebarFilters(), locations: ['Bruxelles, Belgique'] };
    const params = sidebarFiltersToParams(filters);
    // Sam separator komponentu URL (`,` bez escapowania) rozbiłby to na dwie wartości —
    // dowód, że serializacja rzeczywiście coś zmienia względem naiwnego joina.
    expect(params['location']).toBe('Bruxelles\\, Belgique');

    const flat = { location: params['location'] };
    const parsed = parseSidebarFilters(flat);
    expect(parsed.locations).toEqual(['Bruxelles, Belgique']);
  });

  it('rozróżnia dwie osobne lokalizacje od jednej nazwy z przecinkiem', () => {
    const two = joinLocationsParam(['Brussels', 'Antwerp']);
    const one = joinLocationsParam(['Bruxelles, Belgique']);
    expect(parseLocationsParam(two)).toEqual(['Brussels', 'Antwerp']);
    expect(parseLocationsParam(one)).toEqual(['Bruxelles, Belgique']);
    // Kontrola ujemna: bez escapowania oba przypadki dałyby ten sam wynik dwóch tokenów —
    // rozróżnienie musi pochodzić z backslasha, nie z samej treści.
    expect(two).not.toBe(one.replace(/\\,/g, ','));
  });

  it('zachowuje zgodność wstecz ze starym CSV bez backslashy (dwa różne miasta)', () => {
    // Stare zapisane wyszukiwania/linki nie mają backslashy — muszą parsować się tak samo.
    expect(parseLocationsParam('Brussels,Antwerp')).toEqual(['Brussels', 'Antwerp']);
    expect(parseLocationsParam(' Brussels , Antwerp ')).toEqual(['Brussels', 'Antwerp']);
  });

  it('escapuje też literalny backslash w nazwie miasta', () => {
    const value = 'Foo\\Bar, Baz';
    const encoded = joinLocationsParam([value]);
    expect(parseLocationsParam(encoded)).toEqual([value]);
  });

  it('KONTROLA UJEMNA: naiwny join/split gubi jedną nazwę z przecinkiem', () => {
    const naiveJoin = ['Bruxelles, Belgique'].join(',');
    const naiveSplit = naiveJoin.split(',').map((part) => part.trim());
    expect(naiveSplit).toEqual(['Bruxelles', 'Belgique']);
    expect(naiveSplit).not.toEqual(['Bruxelles, Belgique']);
  });

  it('pusta i pojedyncza lokalizacja bez przecinka roundtripują bez zmian', () => {
    expect(joinLocationsParam([])).toBe('');
    expect(parseLocationsParam(undefined)).toEqual([]);
    expect(parseLocationsParam(joinLocationsParam(['Antwerp']))).toEqual(['Antwerp']);
  });
});
