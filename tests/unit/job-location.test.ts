import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jobCityAssist } from '@/lib/actions/job-location';
import { captureError } from '@/lib/error-report';
import { LOCATION_KEYS, cityAliases, resolveLocationKey } from '@/lib/locations/city-aliases';
import {
  cityKeyPrefixPattern,
  demoJobCityAssist,
  pickSuggestions,
} from '@/lib/locations/job-city';
import { cityKey } from '@/lib/matching/belgian-cities';
import { generate } from '../../scripts/locations/build-migration.mjs';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

/**
 * Kanoniczne miasto oferty (audyt P1-10, migracja 0200). Zapis `jobs.location_id` i filtry
 * sprawdza rls.sql sekcja LC200 (PG16); tu: zgodność klucza TS z SQL, gwarancje słownika dla
 * landingów/facetów i podpowiedź kreatora.
 */

describe('city_key (SQL) = cityKey (TS)', () => {
  // Te same przypadki co rls.sql LC200-1 — rozjazd normalizacji = inna miejscowość w bazie i w UI.
  it.each([
    ['Antwerpen', 'antwerpen'],
    ['  ANTWERPEN ', 'antwerpen'],
    ['Liège', 'liege'],
    ['Sint-Niklaas', 'sint niklaas'],
    ['La  Louvière', 'la louviere'],
    ['Braine-l’Alleud', 'braine l’alleud'],
    ['Kessel -  Lo', 'kessel lo'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(cityKey(input)).toBe(expected);
  });
});

describe('słownik 0112 a landingi i facety miast', () => {
  const { rows, aliases } = generate();
  const slugByKey = new Map<string, string>(aliases.map((a: { key: string; slug: string }) => [a.key, a.slug]));

  it('każda nazwa 10 miast z landingów (PL/NL/FR/EN) prowadzi do jednej miejscowości w bazie', () => {
    for (const key of LOCATION_KEYS) {
      const slugs = new Set(cityAliases(key).map((name) => slugByKey.get(cityKey(name))));
      expect([...slugs], key).toEqual([key]);
    }
  });

  it('nazwa kanoniczna miejscowości (klucz facetu z SQL) scala się z tłumaczeniem miasta', () => {
    for (const key of LOCATION_KEYS) {
      const row = rows.find((r: { slug: string }) => r.slug === key);
      expect(row, key).toBeDefined();
      expect(resolveLocationKey(row!.name), key).toBe(key);
    }
  });

  it('kontrola ujemna: nazwa spoza słownika nie ma miejscowości ani klucza facetu', () => {
    expect(slugByKey.get(cityKey('Antwerpiaa'))).toBeUndefined();
    expect(resolveLocationKey('Antwerp City')).toBeNull();
  });
});

describe('podpowiedź miasta w kreatorze — logika', () => {
  it('prefiks LIKE escapuje znaki specjalne', () => {
    expect(cityKeyPrefixPattern('ant')).toBe('ant%');
    expect(cityKeyPrefixPattern('a%b_c\\')).toBe('a\\%b\\_c\\\\%');
  });

  it('jedna propozycja na miejscowość: nazwa własna przed slugiem, kolejność słownika, limit', () => {
    const rows = [
      { locationId: 'b', alias: 'Brugge', sortOrder: 90 },
      { locationId: 'a', alias: 'brussels', sortOrder: 10 },
      { locationId: 'a', alias: 'Bruxelles', sortOrder: 10 },
      { locationId: 'a', alias: 'Brussel', sortOrder: 10 },
      { locationId: 'b', alias: 'Bruges', sortOrder: 90 },
    ];
    expect(pickSuggestions(rows)).toEqual(['Brussel', 'Brugge']);
    expect(pickSuggestions(rows, 1)).toEqual(['Brussel']);
  });

  it('alias techniczny małymi literami zastępuje nazwa miejscowości (kontrola ujemna: bez nazwy zostaje alias)', () => {
    expect(pickSuggestions([{ locationId: 'c', alias: 'charleroi', sortOrder: 80, name: 'Charleroi' }])).toEqual(['Charleroi']);
    expect(pickSuggestions([{ locationId: 'c', alias: 'charleroi', sortOrder: 80 }])).toEqual(['charleroi']);
  });

  it('tryb demo: lista kanoniczna w kodzie, ta sama reguła klucza', () => {
    expect(demoJobCityAssist('antwerpia').slug).toBe('antwerp');
    expect(demoJobCityAssist(' ANVERS ').slug).toBe('antwerp');
    expect(demoJobCityAssist('Nieznanowo')).toEqual({ slug: null, suggestions: [] });
    expect(demoJobCityAssist('Br').suggestions).toEqual(expect.arrayContaining(['Brussel', 'Bruges']));
    // Kontrola ujemna: jeden znak = bez propozycji.
    expect(demoJobCityAssist('B').suggestions).toEqual([]);
  });
});

describe('jobCityAssist (akcja serwerowa)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb({ id: USER, role: 'employer' });
  });

  function dictionary(options: { exact?: unknown[]; prefix?: unknown[]; fail?: boolean } = {}) {
    const fail = () => { throw pgError('XX000', 'DATABASE_UNAVAILABLE'); };
    fakeDb
      .rows('job-city.lookup', options.fail ? fail : (options.exact ?? []))
      .rows('job-city.suggest', options.fail ? fail : (options.prefix ?? []));
  }

  it('rozpoznaje miejscowość po kluczu i pokazuje nazwę w języku strony', async () => {
    dictionary({
      exact: [{ slug: 'antwerp', name: 'Antwerp' }],
      prefix: [{ location_id: 'l1', alias: 'Antwerpen', sort_order: 20 }, { location_id: 'l1', alias: 'antwerp', sort_order: 20 }],
    });
    expect(await jobCityAssist({ city: '  ANTWERPEN ', locale: 'pl' })).toEqual({
      status: 'ok', match: { slug: 'antwerp', name: 'Antwerpia' }, suggestions: ['Antwerpen'],
    });
    expect(fakeDb.callsTo('job-city.lookup')[0]?.values).toEqual(['antwerpen']);
    expect(fakeDb.callsTo('job-city.suggest')[0]?.values).toEqual(['antwerpen%']);
    // Odczyt pod sesją (RLS), nie service_role; akcja niczego nie zapisuje.
    expect(new Set(fakeDb.calls.map((c) => c.as))).toEqual(new Set([USER]));
    expect(fakeDb.calls.every((c) => c.kind === 'rows')).toBe(true);
  });

  it('gmina spoza 10 tłumaczonych miast: nazwa ze słownika', async () => {
    dictionary({ exact: [{ slug: 'aalst', name: 'Aalst' }] });
    expect(await jobCityAssist({ city: 'Alost', locale: 'fr' })).toMatchObject({ match: { slug: 'aalst', name: 'Aalst' } });
  });

  it('nieznana nazwa = brak dopasowania (nie błąd)', async () => {
    dictionary();
    expect(await jobCityAssist({ city: 'Nieznanowo', locale: 'nl' })).toEqual({ status: 'ok', match: null, suggestions: [] });
  });

  it('awaria bazy = jawny błąd, zgłoszony do kanału błędów', async () => {
    dictionary({ fail: true });
    expect(await jobCityAssist({ city: 'Gent', locale: 'pl' })).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'jobs.jobCityAssist' });
  });

  it('kontrola ujemna: bez sesji i przy złych danych — bez zapytań', async () => {
    fakeSession.identity = null;
    expect(await jobCityAssist({ city: 'Gent', locale: 'pl' })).toEqual({ status: 'error' });
    fakeSession.identity = { id: USER, role: 'employer' };
    expect(await jobCityAssist({ city: 42 })).toEqual({ status: 'error' });
    expect(await jobCityAssist({ city: '   ', locale: 'pl' })).toEqual({ status: 'ok', match: null, suggestions: [] });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo (bez bazy): lista w kodzie', async () => {
    fakeSession.configured = false;
    expect(await jobCityAssist({ city: 'Gand', locale: 'en' })).toMatchObject({
      status: 'ok', match: { slug: 'ghent', name: 'Ghent' },
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
