import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BELGIAN_CITIES, belgianCityCoordinates } from '@/lib/matching/belgian-cities';
import { resolveCoordinates, type LocationRow } from '@/lib/matching/locations';
import { distanceKm, scoreMatch, type MatchCandidate, type MatchJob } from '@/lib/matching/score';

/** #194: współrzędne ze słownika bazy, potem z kanonicznej listy w kodzie — nigdy szacunek. */
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

  it('słownik bazy ma pierwszeństwo przed listą w kodzie', () => {
    const rows: LocationRow[] = [{ name: 'Namur', slug: 'namur', latitude: 50.1, longitude: 4.1 }];
    expect(resolveCoordinates('Namur', rows)).toEqual({ lat: 50.1, lng: 4.1 });
  });

  it('miasto spoza słownika bazy → kanoniczna lista, także nazwa w innym języku', () => {
    expect(resolveCoordinates('Gent', ROWS)).toEqual({ lat: 51.0541, lng: 3.7172 });
    expect(resolveCoordinates('Namen', [])).toEqual({ lat: 50.4674, lng: 4.8718 });
    expect(resolveCoordinates('sint niklaas', [])).toEqual(resolveCoordinates('Saint-Nicolas', []));
    expect(resolveCoordinates('Nowhere', ROWS)).toBeUndefined();
  });

  it('miasto nieznane albo puste → undefined (kontrola ujemna)', () => {
    expect(resolveCoordinates('Atlantyda', ROWS)).toBeUndefined();
    expect(resolveCoordinates('Gen', ROWS)).toBeUndefined();
    expect(resolveCoordinates('', ROWS)).toBeUndefined();
    expect(resolveCoordinates('   ', ROWS)).toBeUndefined();
    expect(resolveCoordinates(undefined, ROWS)).toBeUndefined();
  });
});

describe('kanoniczna lista belgijskich miast (#194)', () => {
  it('10 miast ze słownika bazy ma te same współrzędne co migracja 0010', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0010_seed_dictionaries.sql'),
      'utf8',
    );
    const rows = [...sql.matchAll(/\('([a-z-]+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'BE',\s*([\d.]+),\s*([\d.]+)/g)];
    expect(rows).toHaveLength(10);
    for (const [, slug, lat, lng] of rows) {
      const city = BELGIAN_CITIES.find((c) => c.slug === slug);
      expect(city, slug).toBeDefined();
      expect(city!.lat).toBeCloseTo(Number(lat), 4);
      expect(city!.lng).toBeCloseTo(Number(lng), 4);
    }
  });

  it('współrzędne leżą w Belgii, slugi i aliasy są jednoznaczne', () => {
    const seen = new Map<string, string>();
    for (const city of BELGIAN_CITIES) {
      expect(city.lat, city.slug).toBeGreaterThan(49.49);
      expect(city.lat, city.slug).toBeLessThan(51.51);
      expect(city.lng, city.slug).toBeGreaterThan(2.54);
      expect(city.lng, city.slug).toBeLessThan(6.41);
      for (const name of [city.slug, ...city.aliases]) {
        const key = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, ' ');
        const owner = seen.get(key);
        expect(owner === undefined || owner === city.slug, `${name}: ${owner}/${city.slug}`).toBe(true);
        seen.set(key, city.slug);
      }
    }
  });

  it('nazwy miast w PL/NL/FR/EN z `locations.*` mają współrzędne', async () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = (await import(`@/messages/${locale}.json`)).default as {
        locations: Record<string, string>;
      };
      for (const name of Object.values(messages.locations)) {
        expect(belgianCityCoordinates(name), `${locale}: ${name}`).toBeDefined();
      }
    }
  });
});

describe('dopasowanie z odległości dla miast spoza słownika bazy (#194)', () => {
  const candidate = (over: Partial<MatchCandidate>): MatchCandidate => ({
    occupations: [],
    categories: [],
    skills: [],
    languages: [],
    certificates: [],
    preferredContractTypes: [],
    ...over,
  });
  const job = (over: Partial<MatchJob>): MatchJob => ({ skills: [], requiredLanguages: [], ...over });
  const at = (city: string) => resolveCoordinates(city, []);

  it('Aalst–Gent (~27 km, ten sam region): w promieniu 30 → 15 pkt, promień 20 → 0', () => {
    const d = distanceKm(at('Aalst')!, at('Gent')!);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(30);
    const j = job({ city: 'Gent', region: 'Flanders', coordinates: at('Gent') });
    const near = scoreMatch(candidate({ city: 'Aalst', region: 'Flanders', radiusKm: 30, coordinates: at('Aalst') }), j);
    const far = scoreMatch(candidate({ city: 'Aalst', region: 'Flanders', radiusKm: 20, coordinates: at('Aalst') }), j);
    expect(near.strengths).toContain('withinCommuteRadius');
    expect(near.score).toBe(100);
    expect(far.missing).toContain('location');
    expect(far.score).toBe(85);
  });

  it('Mouscron–Kortrijk (inne regiony, ~13 km): liczy się promień, nie nazwa regionu', () => {
    const r = scoreMatch(
      candidate({ city: 'Mouscron', region: 'Wallonia', radiusKm: 15, coordinates: at('Mouscron') }),
      job({ city: 'Kortrijk', region: 'Flanders', coordinates: at('Kortrijk') }),
    );
    expect(r.strengths).toContain('withinCommuteRadius');
    expect(r.missing).not.toContain('location');
  });

  it('Arlon–Oostende w tym samym kraju, promień 50 → poza promieniem (kontrola ujemna)', () => {
    const r = scoreMatch(
      candidate({ city: 'Arlon', region: 'Wallonia', radiusKm: 50, coordinates: at('Arlon') }),
      job({ city: 'Oostende', region: 'Flanders', coordinates: at('Oostende') }),
    );
    expect(r.missing).toContain('location');
    expect(r.strengths).not.toContain('withinCommuteRadius');
  });

  it('praca zdalna: pełne punkty mimo odległości poza promieniem', () => {
    const r = scoreMatch(
      candidate({ city: 'Arlon', radiusKm: 5, coordinates: at('Arlon') }),
      job({ remote: true, city: 'Oostende', coordinates: at('Oostende') }),
    );
    expect(r.strengths).toContain('remoteJob');
    expect(r.score).toBe(100);
  });
});
