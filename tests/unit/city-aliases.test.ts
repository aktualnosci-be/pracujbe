import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/job-filter-facets/route';
import {
  cityAliases,
  countByLocationKey,
  expandLocationAliases,
  localizeLocationFacets,
  localizeLocations,
  mergeLocationFacets,
  resolveCityFilters,
  resolveLocationKey,
} from '@/lib/locations/city-aliases';

/** #189 — miasto filtrowane po stabilnym kluczu i wszystkich nazwach, nie po nazwie w języku strony. */

describe('city aliases', () => {
  it.each(['Bruksela', 'Brussel', 'Bruxelles', 'Brussels'])('%s → brussels', (name) => {
    expect(resolveLocationKey(name)).toBe('brussels');
  });

  it('keeps Liège/Luik together and does not guess unknown or partial names', () => {
    expect(resolveLocationKey('Luik')).toBe('liege');
    expect(resolveLocationKey('Liège')).toBe('liege');
    expect(resolveLocationKey('Brussels-Capital')).toBeNull();
    expect(resolveLocationKey('Brus')).toBeNull();
    expect(resolveLocationKey('Namur')).toBeNull();
  });

  it('expands a selected city to every alias and leaves unknown names as they are', () => {
    expect(new Set(expandLocationAliases(['Bruksela', 'Namur']))).toEqual(
      new Set(['Bruksela', 'Brussel', 'Bruxelles', 'Brussels', 'Namur']),
    );
    expect(new Set(cityAliases('liege'))).toEqual(new Set(['Liège', 'Luik']));
  });

  it('shows the city in the page language without duplicates', () => {
    expect(localizeLocations(['Bruksela', 'Brussels', 'Namur'], 'nl')).toEqual(['Brussel', 'Namur']);
  });

  it('merges facet variants of one city and counts per key with the exact-alias rule', () => {
    const facets = [
      { city: 'Brussels', count: 3 },
      { city: 'Bruxelles', count: 2 },
      { city: 'Luik', count: 1 },
      { city: 'Namur', count: 4 },
    ];
    expect(mergeLocationFacets(facets, 'pl')).toEqual([
      { city: 'Bruksela', count: 5 },
      { city: 'Namur', count: 4 },
      { city: 'Liège', count: 1 },
    ]);
    expect(countByLocationKey(facets, ['brussels', 'liege', 'ghent'])).toEqual({
      brussels: 5,
      liege: 1,
      ghent: 0,
    });
  });

  it('queries a recognised city by aliases without rewriting the URL values', () => {
    const recognised = resolveCityFilters({ city: 'Bruksela', locations: [] }, 'fr');
    expect(recognised.city).toBeUndefined();
    expect(new Set(recognised.queryLocations)).toEqual(
      new Set(['Bruksela', 'Brussel', 'Bruxelles', 'Brussels']),
    );
    expect(recognised.cityLabel).toBe('Bruxelles');

    // city + location działają jak dotąd (oba warunki): część wspólna aliasów.
    const both = resolveCityFilters({ city: 'Bruksela', locations: ['Brussels', 'Luik'] }, 'nl');
    expect(new Set(both.queryLocations)).toEqual(
      new Set(['Bruksela', 'Brussel', 'Bruxelles', 'Brussels']),
    );
    expect(both.displayLocations).toEqual(['Brussel', 'Luik']);

    expect(resolveCityFilters({ city: 'Brus', locations: [] }, 'fr')).toMatchObject({
      city: 'Brus',
      cityKey: null,
      queryLocations: [],
    });
  });

  it('keeps only variants of the searched city in the database location facet', () => {
    const facets = [
      { city: 'Brussels', count: 3 },
      { city: 'Bruxelles', count: 2 },
      { city: 'Antwerpen', count: 7 },
    ];
    expect(localizeLocationFacets(facets, 'brussels', 'nl')).toEqual([{ city: 'Brussel', count: 5 }]);
    expect(localizeLocationFacets(facets, null, 'nl')).toHaveLength(2);
  });
});

describe('GET /api/job-filter-facets (demo) — język strony nie zmienia zbioru', () => {
  async function total(query: string): Promise<number> {
    const response = await GET(new Request(`http://localhost/api/job-filter-facets?${query}`));
    return ((await response.json()) as { total: number }).total;
  }

  it('location=Bruksela daje ten sam wynik w każdym języku', async () => {
    const pl = await total('locale=pl&location=Bruksela');
    expect(pl).toBeGreaterThan(0);
    for (const locale of ['nl', 'fr', 'en']) {
      expect(await total(`locale=${locale}&location=Bruksela`)).toBe(pl);
      expect(await total(`locale=${locale}&city=Bruksela`)).toBe(pl);
    }
  });
});
