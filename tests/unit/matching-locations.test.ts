import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BELGIAN_CITIES, belgianCityCoordinates, cityKey, type BelgianCity } from '@/lib/matching/belgian-cities';
import { locationLookupKeys, resolveCoordinates, type LocationAliasRow } from '@/lib/matching/locations';
import { distanceKm, scoreMatch, type MatchCandidate, type MatchJob } from '@/lib/matching/score';
import {
  MIGRATION_FILE,
  SECTIONS_MIGRATION_FILE,
  SEEDED_0010,
  buildSections,
  generate,
  generateSections,
  parseCuratedCities,
} from '../../scripts/locations/build-migration.mjs';
import { cityKey as scriptCityKey } from '../../scripts/locations/city-key.mjs';

/** #194: współrzędne ze słownika bazy (aliasy), potem z kanonicznej listy w kodzie — nigdy szacunek. */
const ROWS: LocationAliasRow[] = [
  { aliasKey: 'liege', latitude: 50.6326, longitude: 5.5797 },
  { aliasKey: 'luik', latitude: 50.6326, longitude: 5.5797 },
  { aliasKey: 'ghent', latitude: 51.0541, longitude: 3.7172 },
  { aliasKey: 'nowhere', latitude: null, longitude: null },
];

describe('resolveCoordinates', () => {
  it('dopasowuje alias po kluczu bez wielkości liter i diakrytyków', () => {
    expect(resolveCoordinates('liege', ROWS)).toEqual({ lat: 50.6326, lng: 5.5797 });
    expect(resolveCoordinates(' LIÈGE ', ROWS)).toEqual({ lat: 50.6326, lng: 5.5797 });
    expect(resolveCoordinates('Luik', ROWS)).toEqual({ lat: 50.6326, lng: 5.5797 });
    expect(resolveCoordinates('Ghent', ROWS)).toEqual({ lat: 51.0541, lng: 3.7172 });
  });

  it('słownik bazy ma pierwszeństwo przed listą w kodzie', () => {
    const rows: LocationAliasRow[] = [{ aliasKey: 'namur', latitude: 50.1, longitude: 4.1 }];
    expect(resolveCoordinates('Namur', rows)).toEqual({ lat: 50.1, lng: 4.1 });
  });

  it('miasto spoza słownika bazy → kanoniczna lista, także nazwa w innym języku', () => {
    expect(resolveCoordinates('Gent', ROWS)).toEqual({ lat: 51.0541, lng: 3.7172 });
    expect(resolveCoordinates('Namen', [])).toEqual({ lat: 50.4674, lng: 4.8718 });
    expect(resolveCoordinates('sint niklaas', [])).toEqual(resolveCoordinates('Sint-Niklaas', []));
    expect(resolveCoordinates('sint niklaas', [])).toBeDefined();
    expect(resolveCoordinates('Nowhere', ROWS)).toBeUndefined();
  });

  it('miasto nieznane albo puste → undefined (kontrola ujemna)', () => {
    expect(resolveCoordinates('Atlantyda', ROWS)).toBeUndefined();
    expect(resolveCoordinates('Gen', ROWS)).toBeUndefined();
    expect(resolveCoordinates('', ROWS)).toBeUndefined();
    expect(resolveCoordinates('   ', ROWS)).toBeUndefined();
    expect(resolveCoordinates(undefined, ROWS)).toBeUndefined();
  });

  it('klucze zapytania: cityKey, bez pustych i duplikatów', () => {
    expect(locationLookupKeys('Liège', ' liege ', '', undefined, 'Sint-Niklaas')).toEqual(['liege', 'sint niklaas']);
    expect(locationLookupKeys(undefined, '  ')).toEqual([]);
  });
});

type GeneratedRow = { slug: string; name: string; lat: number; lng: number; kind: string; refnis: string | null; sortOrder: number };
type GeneratedAlias = { slug: string; alias: string; key: string };

/**
 * Lustro TS ↔ słownik z migracji: każde miasto listy kanonicznej ma w bazie wiersz o tym samym
 * slugu i współrzędnych, a każda jego nazwa (klucz) prowadzi do tego wiersza. Zwraca listę
 * rozbieżności (pusta = zgodne) — osobna funkcja, żeby kontrola ujemna mogła ją wywołać.
 */
function mirrorProblems(cities: readonly BelgianCity[], rows: GeneratedRow[], aliases: GeneratedAlias[]): string[] {
  const problems: string[] = [];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const byKey = new Map(aliases.map((a) => [a.key, a.slug]));
  for (const city of cities) {
    const row = bySlug.get(city.slug);
    if (!row) { problems.push(`${city.slug}: brak wiersza`); continue; }
    if (row.lat.toFixed(6) !== city.lat.toFixed(6) || row.lng.toFixed(6) !== city.lng.toFixed(6)) {
      problems.push(`${city.slug}: współrzędne ${row.lat},${row.lng} ≠ ${city.lat},${city.lng}`);
    }
    for (const name of [city.slug, ...city.aliases]) {
      const owner = byKey.get(cityKey(name));
      if (owner !== city.slug) problems.push(`${city.slug}: alias ${name} → ${owner ?? 'brak'}`);
    }
  }
  return problems;
}

describe('słownik locations w bazie (#194, migracja 0112)', () => {
  const generated = generate();
  const migrationSql = readFileSync(join(process.cwd(), MIGRATION_FILE), 'utf8');

  it('migracja = wynik generatora (lista w kodzie + migawka Wikidata)', () => {
    expect(migrationSql).toBe(generated.sql);
  });

  it('kontrola ujemna: zmieniona współrzędna w pliku migracji nie przechodzi porównania', () => {
    const tampered = migrationSql.replace('51.219400, 4.402500', '51.219400, 4.402600');
    expect(tampered).not.toBe(migrationSql);
    expect(tampered).not.toBe(generated.sql);
  });

  it('parser generatora czyta dokładnie listę BELGIAN_CITIES', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/matching/belgian-cities.ts'), 'utf8');
    expect(parseCuratedCities(source)).toEqual(BELGIAN_CITIES.map((c) => ({ ...c, aliases: [...c.aliases] })));
  });

  it('lustro TS: każde miasto z listy ma w bazie te same współrzędne i aliasy', () => {
    expect(mirrorProblems(BELGIAN_CITIES, generated.rows, generated.aliases)).toEqual([]);
  });

  it('kontrola ujemna lustra: przesunięta współrzędna, alias spoza bazy i brak miasta są wykrywane', () => {
    const shifted = BELGIAN_CITIES.map((c) => (c.slug === 'namur' ? { ...c, lat: c.lat + 0.01 } : c));
    expect(mirrorProblems(shifted, generated.rows, generated.aliases)).toEqual([
      expect.stringContaining('namur: współrzędne'),
    ]);
    const extraAlias = BELGIAN_CITIES.map((c) => (c.slug === 'mons' ? { ...c, aliases: [...c.aliases, 'Monsieur'] } : c));
    expect(mirrorProblems(extraAlias, generated.rows, generated.aliases)).toEqual(['mons: alias Monsieur → brak']);
    const missing = [...BELGIAN_CITIES, { slug: 'atlantyda', lat: 50.5, lng: 4.5, aliases: ['Atlantyda'] }];
    expect(mirrorProblems(missing, generated.rows, generated.aliases)).toEqual(['atlantyda: brak wiersza']);
    const stolen = generated.aliases.map((a) => (a.key === 'bergen' ? { ...a, slug: 'namur' } : a));
    expect(mirrorProblems(BELGIAN_CITIES, generated.rows, stolen)).toEqual(['mons: alias Bergen → namur']);
  });

  it('wiersze 0010 zachowują nazwę, współrzędne i kolejność', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0010_seed_dictionaries.sql'), 'utf8');
    const seeded = [...sql.matchAll(/\('([a-z-]+)',\s*'([^']*)',\s*'[^']*',\s*'[^']*',\s*'BE',\s*([\d.]+),\s*([\d.]+),\s*(\d+)/g)];
    expect(seeded.map((m) => m[1])).toEqual(SEEDED_0010);
    for (const [, slug, name, lat, lng, sort] of seeded) {
      const row = generated.rows.find((r: GeneratedRow) => r.slug === slug)!;
      expect(row, slug).toBeDefined();
      expect([row.name, row.lat.toFixed(6), row.lng.toFixed(6), row.sortOrder]).toEqual([name, lat, lng, Number(sort)]);
    }
  });

  it('klucze aliasów = cityKey z TS; jeden klucz → jedna miejscowość; slug i NIS unikalne', () => {
    const keys = new Set<string>();
    for (const alias of generated.aliases) {
      expect(alias.key, alias.alias).toBe(cityKey(alias.alias));
      expect(scriptCityKey(alias.alias)).toBe(cityKey(alias.alias));
      expect(keys.has(alias.key), alias.key).toBe(false);
      keys.add(alias.key);
    }
    const slugs = generated.rows.map((r: GeneratedRow) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const refnis = generated.rows.map((r: GeneratedRow) => r.refnis).filter(Boolean);
    expect(new Set(refnis).size).toBe(refnis.length);
    for (const row of generated.rows) {
      expect(generated.aliases.some((a: GeneratedAlias) => a.slug === row.slug), row.slug).toBe(true);
      expect(row.lat, row.slug).toBeGreaterThan(49.49);
      expect(row.lat, row.slug).toBeLessThan(51.51);
      expect(row.lng, row.slug).toBeGreaterThan(2.54);
      expect(row.lng, row.slug).toBeLessThan(6.41);
    }
  });

  it('obejmuje gminy spoza listy w kodzie (także zniesione przy fuzjach) i nazwy w PL/NL/FR/EN', () => {
    const lookup = (name: string) => generated.aliases.find((a: GeneratedAlias) => a.key === cityKey(name))?.slug;
    const municipalities = generated.rows.filter((r: GeneratedRow) => r.kind === 'municipality');
    expect(municipalities.length).toBeGreaterThanOrEqual(560);
    expect(lookup('Elsene')).toBe(lookup('Ixelles'));
    expect(lookup('Ixelles')).toBeDefined();
    expect(lookup('Bornem')).toBeDefined();
    expect(lookup('Kruibeke')).toBeDefined();
    expect(lookup('Tessenderlo-Ham')).toBeDefined();
    expect(lookup('Antwerpia')).toBe('antwerp');
    expect(lookup('Luik')).toBe('liege');
    // Własna nazwa gminy (Saint-Nicolas, prowincja Liège) nie jest egzonimem Sint-Niklaas.
    expect(lookup('Saint-Nicolas')).toBe('saint-nicolas');
    expect(lookup('Sint-Niklaas')).toBe('sint-niklaas');
    // Gmina zniesiona o nazwie obecnej gminy nie dubluje wpisu (Lokeren po fuzji z Moerbeke).
    expect(generated.rows.filter((r: GeneratedRow) => r.name === 'Lokeren')).toHaveLength(1);
  });

  it('dane rzeczywiste: migracja nie oznacza wierszy jako demo i nie woła sieci', () => {
    expect(migrationSql).toContain("'BE', v.latitude, v.longitude, v.sort_order, true, false, v.kind, v.refnis");
    expect(migrationSql).not.toMatch(/https?:\/\/(?!www\.wikidata\.org|creativecommons\.org)/);
  });
});

type SectionRow = GeneratedRow & { parentSlug: string; region: string };

describe('części gmin w słowniku (migracja 0191)', () => {
  const sections = generateSections();
  const migrationSql = readFileSync(join(process.cwd(), SECTIONS_MIGRATION_FILE), 'utf8');
  const bySlug = new Map(sections.rows.map((r: SectionRow) => [r.slug, r]));
  const owner = (name: string) => sections.aliases.find((a: GeneratedAlias) => a.key === cityKey(name))?.slug;

  it('migracja = wynik generatora (migawka części gmin + słownik 0112)', () => {
    expect(migrationSql).toBe(sections.sql);
  });

  it('kontrola ujemna: zmieniona współrzędna części w pliku migracji nie przechodzi porównania', () => {
    const tampered = migrationSql.replace('50.860000, 4.690000', '50.860000, 4.690001');
    expect(tampered).not.toBe(migrationSql);
    expect(tampered).not.toBe(sections.sql);
  });

  it('0112 bez zmian: generator części gmin nie zmienia migracji gmin', () => {
    expect(readFileSync(join(process.cwd(), MIGRATION_FILE), 'utf8')).toBe(generate().sql);
  });

  it('każda część ma gminę z 0112, region gminy, alias i współrzędne w Belgii', () => {
    const municipalities = new Map(sections.municipalities.rows.map((r: GeneratedRow & { region: string }) => [r.slug, r]));
    expect(sections.rows.length).toBeGreaterThanOrEqual(1500);
    for (const row of sections.rows as SectionRow[]) {
      const parent = municipalities.get(row.parentSlug);
      expect(parent, row.slug).toBeDefined();
      expect(['municipality', 'former_municipality'], row.slug).toContain(parent!.kind);
      expect(row.region, row.slug).toBe(parent!.region);
      expect(row.kind).toBe('section');
      expect(sections.aliases.some((a: GeneratedAlias) => a.slug === row.slug), row.slug).toBe(true);
      expect(row.lat, row.slug).toBeGreaterThan(49.49);
      expect(row.lat, row.slug).toBeLessThan(51.51);
      expect(row.lng, row.slug).toBeGreaterThan(2.54);
      expect(row.lng, row.slug).toBeLessThan(6.41);
    }
    const slugs = [...sections.rows, ...sections.municipalities.rows].map((r: GeneratedRow) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const refnis = [...sections.rows, ...sections.municipalities.rows].map((r: GeneratedRow) => r.refnis).filter(Boolean);
    expect(new Set(refnis).size).toBe(refnis.length);
  });

  it('własna nazwa gminy wygrywa: klucze z 0112 nie trafiają do części gmin', () => {
    const reserved = sections.municipalities.reservedKeys as Set<string>;
    const keys = new Set<string>();
    for (const alias of sections.aliases as GeneratedAlias[]) {
      expect(alias.key, alias.alias).toBe(cityKey(alias.alias));
      expect(reserved.has(alias.key), alias.key).toBe(false);
      expect(keys.has(alias.key), alias.key).toBe(false);
      keys.add(alias.key);
    }
    expect(owner('Aalst')).toBeUndefined();
    expect(owner('Leuven')).toBeUndefined();
    expect(bySlug.get(owner('Heverlee')!)?.parentSlug).toBe('leuven');
    expect(bySlug.get(owner('Kessel-Lo')!)?.parentSlug).toBe('leuven');
    expect(bySlug.get(owner('Marcinelle')!)?.parentSlug).toBe('charleroi');
    expect(bySlug.get(owner('Haren')!)?.parentSlug).toBe('brussels');
  });

  it('kontrola ujemna reguł: część o nazwie gminy nie dostaje aliasu, dwie części o tej samej nazwie — żadna', () => {
    const municipalities = sections.municipalities;
    const leuven = municipalities.snapshot.items.find((i: { refnis: string }) => i.refnis === '24062')!;
    const aalst = municipalities.snapshot.items.find((i: { refnis: string }) => i.refnis === '41002')!;
    const item = (qid: string, name: string, parent: string, lat: number | null = 50.9) =>
      ({ qid, nis: null, parents: [parent], successors: [], lat, lng: lat == null ? null : 4.7, labels: { nl: name } });
    const built = buildSections({
      municipalities,
      snapshot: municipalities.snapshot,
      sections: {
        items: [
          item('Q900001', 'Leuven', leuven.qid),
          item('Q900002', 'Testdorp', leuven.qid),
          item('Q900003', 'Testdorp', aalst.qid),
          item('Q900004', 'Eigen Naam', leuven.qid, null),
          item('Q900005', 'Wees', 'Q1'),
        ],
      },
    });
    expect(built.rows.map((r: SectionRow) => r.slug)).toEqual(['eigen-naam-leuven']);
    expect(built.skipped.ambiguous).toEqual([expect.stringContaining('testdorp')]);
    expect(built.skipped.parent).toEqual(['Q900005']);
    // Brak współrzędnych części → współrzędne gminy nadrzędnej.
    const parent = municipalities.rows.find((r: GeneratedRow) => r.slug === 'leuven')!;
    expect([built.rows[0]!.lat, built.rows[0]!.lng]).toEqual([parent.lat, parent.lng]);
  });

  it('matching: część gminy spoza listy w kodzie ma współrzędne tylko ze słownika', () => {
    const rows: LocationAliasRow[] = sections.aliases
      .filter((a: GeneratedAlias) => ['heverlee', 'kessel lo'].includes(a.key))
      .map((a: GeneratedAlias) => ({ aliasKey: a.key, latitude: bySlug.get(a.slug)!.lat, longitude: bySlug.get(a.slug)!.lng }));
    const heverlee = resolveCoordinates('Heverlee', rows);
    const kesselLo = resolveCoordinates('Kessel-Lo', rows);
    expect(heverlee && kesselLo && distanceKm(heverlee, kesselLo)).toBeLessThan(10);
    // Kontrola ujemna: bez wierszy słownika nazwa części gminy jest nieznana.
    expect(resolveCoordinates('Heverlee', [])).toBeUndefined();
  });

  it('dane rzeczywiste: bez demo i bez sieci; atrybucja Wikidata CC0', () => {
    expect(migrationSql).toContain("true, false, 'section', v.refnis, p.id");
    expect(migrationSql).toContain('CC0-1.0');
    expect(migrationSql).not.toMatch(/https?:\/\/(?!www\.wikidata\.org|creativecommons\.org)/);
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
