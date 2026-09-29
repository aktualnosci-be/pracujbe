import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/job-filter-facets/route';
import { getJobs } from '@/lib/jobs';
import { parseJobListQuery } from '@/lib/job-list-query';
import { cityKey } from '@/lib/matching/belgian-cities';
import {
  LOCATION_KEYS,
  cityAliases,
  countByLocationKey,
  expandLocationAliases,
  localizeLocationFacets,
  localizeLocations,
  mergeLocationFacets,
  nameKey,
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

/**
 * #1077 — wynik wyszukiwania miasta nie zależy od wielkości liter, diakrytyków ani rodzaju
 * spacji/myślnika wpisu. Dawniej „Bruxelles” było rozpoznawane jako miasto (aliasy), a
 * „bruxelles” zostawało tekstem, więc ten sam zamiar dawał inny zbiór ofert.
 */
describe('#1077 — rozpoznanie miasta bez względu na zapis', () => {
  const variants = ['Bruxelles', 'bruxelles', 'BRUXELLES', '  bruxelles ', 'Bruxelles\u00a0'];

  it.each(variants)('%j → brussels', (value) => {
    expect(resolveLocationKey(value)).toBe('brussels');
  });

  it('znaki diakrytyczne i myślniki: liege = Liège, kolejne spacje nie zmieniają klucza', () => {
    expect(resolveLocationKey('liege')).toBe('liege');
    expect(resolveLocationKey('LIÈGE')).toBe('liege');
    expect(resolveLocationKey('Bru xelles')).toBeNull();
  });

  it('nadal nie zgaduje po fragmencie ani nie łączy różnych nazw', () => {
    expect(resolveLocationKey('brux')).toBeNull();
    expect(resolveLocationKey('bruxelles 1000')).toBeNull();
    expect(resolveLocationKey('')).toBeNull();
  });

  it('klucze wszystkich aliasów są rozłączne między miastami (bez cichych kolizji po złożeniu)', () => {
    const owner = new Map<string, string>();
    for (const key of LOCATION_KEYS) {
      for (const alias of cityAliases(key)) {
        const folded = nameKey(alias);
        expect(owner.get(folded) ?? key, `${alias} koliduje z ${owner.get(folded)}`).toBe(key);
        owner.set(folded, key);
        expect(resolveLocationKey(alias)).toBe(key);
      }
    }
  });

  it('nameKey = cityKey z matchingu (i lustro SQL city_key)', () => {
    for (const value of ['Liège', 'Sint-Niklaas', 'La  Louvière', 'BRUXELLES', 'Gent ']) {
      expect(nameKey(value)).toBe(cityKey(value));
    }
  });

  it('ten sam zbiór parametrów zapytania dla każdego zapisu nazwy', () => {
    const reference = resolveCityFilters({ city: 'Bruxelles', locations: [] }, 'fr');
    for (const value of variants) {
      const other = resolveCityFilters({ city: value.trim(), locations: [] }, 'fr');
      expect(other.city).toBeUndefined();
      expect(new Set(other.queryLocations)).toEqual(new Set(reference.queryLocations));
    }
    // Filtr `location` z sidebara: ta sama reguła.
    expect(new Set(expandLocationAliases(['bruxelles']))).toEqual(new Set(cityAliases('brussels')));
  });

  it('lista ofert: „Bruxelles” i „bruxelles” dają identyczny zbiór wyników', async () => {
    const ids = async (city: string) => {
      const q = parseJobListQuery({ city }, 'fr');
      const result = await getJobs({ ...q.filterParams, page: 1, pageSize: 100 });
      return result.jobs.map((job) => job.id).sort();
    };
    const reference = await ids('Bruxelles');
    expect(reference.length).toBeGreaterThan(0);
    expect(await ids('bruxelles')).toEqual(reference);
    expect(await ids('BRUXELLES')).toEqual(reference);
  });

  it('kontrola ujemna: porównanie dokładne (dawna reguła) rozróżniało zapisy', () => {
    const exact = (value: string) => cityAliases('brussels').includes(value.trim());
    expect(exact('Bruxelles')).toBe(true);
    expect(exact('bruxelles')).toBe(false);
  });

  it('facet w bazie z innym zapisem nazwy jest scalany i pokazany w języku strony', () => {
    const facets = [
      { city: 'BRUXELLES', count: 1 },
      { city: 'Brussels', count: 2 },
      { city: 'liege', count: 1 },
    ];
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      expect(mergeLocationFacets(facets, locale)).toEqual([
        { city: localizeLocations(['Brussels'], locale)[0], count: 3 },
        { city: localizeLocations(['Liège'], locale)[0], count: 1 },
      ]);
    }
  });
});
