// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import {
  emptySidebarFilters,
  flattenSearchParams,
  parseSidebarFilters,
  refinementQueryParams,
  sidebarFiltersToParams,
  sortJobs,
  countActiveSidebar,
} from '@/components/public/job-filters';
import { getJobs } from '@/lib/jobs';
import {
  distanceKm,
  jobWithinRadius,
  LANGUAGE_FILTER_LEVELS,
  languageLevelSatisfies,
  RADIUS_KM_OPTIONS,
  WORK_TIME_FILTERS,
  WORK_TIME_VALUES,
  workTimeMatches,
} from '@/lib/job-filter-options';
import { describeJobListFilters, type FilterSummaryTranslators } from '@/lib/job-filter-summary';
import { parseJobListQuery, savedSearchFiltersFromQuery, savedSearchQueryString } from '@/lib/job-list-query';
import { LANGUAGE_CODES, resolveLanguageCode } from '@/lib/languages';
import { compareSalaryDesc, salaryInRange, salarySortKey } from '@/lib/salary-compare';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Filtry listy ofert z migracji 0194 (numer tymczasowy): waluta (#787), język i poziom (#786),
 * wymiar pracy (#811), promień (#824). Reguły TS są lustrem SQL (dane demo, liczniki na żywo,
 * adres URL, zapisane wyszukiwania) — test porównuje listy wartości z migracją i sprawdza, że
 * każdy filtr naprawdę zawęża wynik (kontrole ujemne).
 */

const MIGRATION = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations',
    readdirSync(path.join(process.cwd(), 'supabase/migrations')).find((f) =>
      f.endsWith('_job_filters_language_worktime_radius.sql'),
    )!,
  ),
  'utf8',
);

describe('#787 waluta: widełki i sortowanie tylko w EUR', () => {
  const eur = { salaryMin: 3000, salaryMax: 3000, salaryPeriod: 'month' as const, currency: 'EUR' };
  const pln = { ...eur, currency: 'PLN' };

  it('3000 PLN nie jest porównywane z widełkami EUR (nieporównywalne jak inny okres)', () => {
    expect(salaryInRange(eur, 4000, Infinity)).toBe(false);
    expect(salaryInRange(pln, 4000, Infinity)).toBe(true);
    expect(salaryInRange(pln, 2500, 3500)).toBe(true);
    expect(salarySortKey(pln)).toBeUndefined();
    expect(salarySortKey(eur)).toBe(3000);
    // Brak waluty = EUR (domyślna wartość kolumny).
    expect(salarySortKey({ salaryMin: 3000, salaryPeriod: 'month' })).toBe(3000);
    // Stawka godzinowa w PLN też nieporównywalna.
    expect(salarySortKey({ salaryMin: 30, salaryPeriod: 'hour', currency: 'PLN' }, 'hour')).toBeUndefined();
  });

  it('sortowanie: EUR malejąco, PLN na końcu', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 28, 12) - h * 3_600_000).toISOString();
    const jobs = [
      { slug: 'pln-5000', salaryMin: 5000, salaryPeriod: 'month' as const, currency: 'PLN', publishedAt: at(1) },
      { slug: 'eur-2000', salaryMin: 2000, salaryPeriod: 'month' as const, currency: 'EUR', publishedAt: at(2) },
      { slug: 'eur-3000', salaryMin: 3000, salaryPeriod: 'month' as const, currency: 'EUR', publishedAt: at(3) },
    ];
    expect(sortJobs(jobs, 'salary').map((j) => j.slug)).toEqual(['eur-3000', 'eur-2000', 'pln-5000']);
    // Kontrola ujemna: bez waluty (jak przed 0194) 5000 PLN byłoby „najwyżej płatne”.
    const noCurrency = jobs.map(({ currency: _c, ...rest }) => rest);
    expect(sortJobs(noCurrency, 'salary')[0]!.slug).toBe('pln-5000');
    expect(compareSalaryDesc(jobs[0]!, jobs[1]!)).toBeGreaterThan(0);
  });

  it('SQL: nowe przeciążenia z walutą w liście, liczniku, facetach i kopii alertów', () => {
    expect(MIGRATION).toMatch(/coalesce\(p_currency, 'EUR'\) <> 'EUR'/);
    const calls = MIGRATION.match(/j\.salary_period,\s*j\.currency,/g) ?? [];
    // lista (filtr + sort), licznik, facety, kopia alertów
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
});

describe('0194: lustro list wartości z migracją', () => {
  it('wymiar pracy: CHECK kolumny i filtr', () => {
    expect(MIGRATION).toContain(`work_time in ('${WORK_TIME_VALUES.join("', '")}')`);
    expect(MIGRATION).toContain(`p_work_time in ('${WORK_TIME_FILTERS.join("', '")}')`);
  });

  it('poziomy języka i promienie w kanonizacji zapisanych wyszukiwań', () => {
    expect(MIGRATION).toContain(`not in ('${LANGUAGE_FILTER_LEVELS.join("', '")}')`);
    expect(MIGRATION).toContain(`not in ('${RADIUS_KM_OPTIONS.join("', '")}')`);
  });

  it('reguły TS: poziom, wymiar i odległość', () => {
    expect(languageLevelSatisfies('fluent', 'intermediate')).toBe(false);
    expect(languageLevelSatisfies('intermediate', 'intermediate')).toBe(true);
    expect(languageLevelSatisfies(null, 'basic')).toBe(true);
    expect(workTimeMatches('both', 'part_time')).toBe(true);
    expect(workTimeMatches(undefined, 'full_time')).toBe(false);
    // Gent–Antwerpia ≈ 51 km (ta sama wartość co `geo_distance_km`, rls.sql FL974-5).
    expect(distanceKm({ lat: 51.0541, lng: 3.7172 }, { lat: 51.2194, lng: 4.4025 })).toBeCloseTo(51.22, 1);
  });

  it('promień: oferta zdalna pasuje do każdego promienia (decyzja właściciela 29.09.2026)', () => {
    const gent = { lat: 51.0541, lng: 3.7172 };
    const arlon = { lat: 49.6833, lng: 5.8167 }; // ≈ 210 km od Gandawy
    // Zdalna daleko poza promieniem, bez współrzędnych albo przy nieznanym środku — pasuje.
    expect(jobWithinRadius({ remote: true, point: arlon }, gent, 5)).toBe(true);
    expect(jobWithinRadius({ remote: true, point: undefined }, gent, 5)).toBe(true);
    expect(jobWithinRadius({ remote: true, point: arlon }, undefined, 5)).toBe(true);
    // Kontrola ujemna: ta sama oferta niezdalna poza promieniem odpada, w promieniu — zostaje.
    expect(jobWithinRadius({ remote: false, point: arlon }, gent, 100)).toBe(false);
    expect(jobWithinRadius({ point: arlon }, gent, 100)).toBe(false);
    expect(jobWithinRadius({ remote: false, point: undefined }, gent, 100)).toBe(false);
    expect(jobWithinRadius({ remote: false, point: gent }, gent, 5)).toBe(true);
  });

  it('SQL: `jobs.remote` omija promień w liście, liczniku, facetach i kopii alertów', () => {
    const conditions =
      MIGRATION.match(
        /and \(coalesce\(btrim\(p_near\), ''\) = ''\s+or j\.remote is true\s+or j\.location_id in/g,
      ) ?? [];
    expect(conditions).toHaveLength(4);
    // Kontrola ujemna: żaden warunek promienia bez gałęzi pracy zdalnej.
    expect(MIGRATION).not.toMatch(/and \(coalesce\(btrim\(p_near\), ''\) = ''\s+or j\.location_id in/);
  });
});

describe('0194: adres URL filtrów', () => {
  it('parsowanie i serializacja są odwracalne', () => {
    const f = parseSidebarFilters({
      lang: 'nl', langLevel: 'fluent', workTime: 'part_time', near: '  Gent ', radius: '50',
    });
    expect(f).toMatchObject({ language: 'nl', languageLevel: 'fluent', workTime: 'part_time', near: 'Gent', radiusKm: 50 });
    expect(sidebarFiltersToParams(f)).toEqual({
      lang: 'nl', langLevel: 'fluent', workTime: 'part_time', near: 'Gent', radius: '50',
    });
    expect(parseSidebarFilters(sidebarFiltersToParams(f))).toEqual(f);
    expect(countActiveSidebar(f)).toBe(3);
    expect(refinementQueryParams(f)).toEqual({
      language: 'nl', languageLevel: 'fluent', workTime: 'part_time', near: 'Gent', radiusKm: 50,
    });
  });

  it('wartości spoza list i osierocone parametry są ignorowane', () => {
    const f = parseSidebarFilters({ lang: 'xx', langLevel: 'fluent', workTime: 'both', near: '', radius: '7' });
    expect(f).toEqual(emptySidebarFilters());
    expect(sidebarFiltersToParams(f)).toEqual({});
    // Poziom bez języka nic nie znaczy; promień spoza listy = domyślne 25 km.
    expect(parseSidebarFilters({ langLevel: 'native' }).languageLevel).toBeNull();
    expect(parseSidebarFilters({ near: 'Gent', radius: '7' }).radiusKm).toBe(25);
    expect(parseSidebarFilters({ near: 'x'.repeat(150) }).near).toHaveLength(100);
  });

  it('formularz bez JavaScriptu (puste pola) nie włącza filtrów', () => {
    const flat = flattenSearchParams({ near: '', radius: '25', workTime: '', lang: '', langLevel: '' });
    expect(refinementQueryParams(parseSidebarFilters(flat))).toEqual({});
  });
});

describe('0194: zapisane wyszukiwanie i chipy', () => {
  const query = parseJobListQuery(
    { lang: 'fr', langLevel: 'basic', workTime: 'full_time', near: 'Luik', radius: '10' },
    'nl',
  );

  it('filtry trafiają do zapytania listy i do zapisanego wyszukiwania', () => {
    expect(query.filterParams).toMatchObject({
      language: 'fr', languageLevel: 'basic', workTime: 'full_time', near: 'Luik', radiusKm: 10,
    });
    expect(savedSearchFiltersFromQuery(query)).toEqual({
      language: 'fr', languageLevel: 'basic', workTime: 'full_time', near: 'Luik', radiusKm: 10,
    });
    expect(new URLSearchParams(savedSearchQueryString(query).slice(1)).get('near')).toBe('Luik');
  });

  const MESSAGES = { pl, en, fr, nl } as const;
  function translators(locale: keyof typeof MESSAGES): FilterSummaryTranslators {
    const make = (namespace: 'filters' | 'categories' | 'contractTypes' | 'languageNames') => {
      const t = createTranslator({ locale, messages: MESSAGES[locale], namespace });
      return (key: string, values?: Record<string, string | number>) =>
        (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
    };
    return {
      filters: make('filters'),
      categories: make('categories'),
      contractTypes: make('contractTypes'),
      languageNames: make('languageNames'),
    };
  }

  it.each(['pl', 'en', 'fr', 'nl'] as const)('chipy w języku widza (%s) i usuwanie parametrów razem', (locale) => {
    const items = describeJobListFilters(query, locale, translators(locale));
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    const f = MESSAGES[locale].filters;
    expect(byId['lang']!.label).toContain(MESSAGES[locale].languageNames.fr);
    expect(byId['lang']!.label).toContain(f.languageLevels.basic);
    expect(byId['lang']!.alsoRemove).toEqual(['langLevel']);
    expect(byId['worktime']!.label).toBe(f.workTimeFull);
    expect(byId['near']!.label).toContain('Luik');
    expect(byId['near']!.label).toContain('10');
    expect(byId['near']!.alsoRemove).toEqual(['radius']);
  });
});

describe('0194: lustro demo (`getJobs` bez bazy)', () => {
  const base = { locale: 'pl' as const, page: 1, pageSize: 100 };

  it('wymagany język: tylko oferty z tym językiem (kontrola ujemna: bez filtra więcej)', async () => {
    const all = await getJobs(base);
    const french = await getJobs({ ...base, language: 'fr' });
    expect(french.total).toBeGreaterThan(0);
    expect(french.total).toBeLessThan(all.total);
    for (const job of french.jobs) {
      const detail = job as typeof job & { languages?: string[] };
      expect(detail.languages?.some((label) => resolveLanguageCode(label) === 'fr')).toBe(true);
    }
    expect((await getJobs({ ...base, language: 'ar' })).total).toBe(0);
    expect(LANGUAGE_CODES).toContain('ar');
  });

  it('wymiar pracy: część etatu tylko z deklaracją', async () => {
    const all = await getJobs(base);
    const part = await getJobs({ ...base, workTime: 'part_time' });
    expect(part.total).toBeGreaterThan(0);
    expect(part.total).toBeLessThan(all.total);
    for (const job of part.jobs) expect((job as typeof job & { workTime?: string }).workTime).toBe('part_time');
  });

  it('promień: miasta w zasięgu, nierozpoznana miejscowość = brak wyników', async () => {
    const near = await getJobs({ ...base, near: 'Gandawa', radiusKm: 10 });
    expect(near.total).toBeGreaterThan(0);
    for (const job of near.jobs) expect(job.city).toBe('Gandawa');
    const wider = await getJobs({ ...base, near: 'Gandawa', radiusKm: 100 });
    expect(wider.total).toBeGreaterThan(near.total);
    expect((await getJobs({ ...base, near: 'Nieznane Miasto', radiusKm: 100 })).total).toBe(0);
  });
});
