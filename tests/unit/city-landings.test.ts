import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #920: katalog landingów miast i jedna reguła kwalifikacji (próg podaży) dla metadanych,
 * huba i sitemapy (sitemap: `sitemap-seo.test.ts`).
 */

const { getJobs, getJobsCount, getCityCounts, getCategoryCounts } = vi.hoisted(() => ({
  getJobs: vi.fn(),
  getJobsCount: vi.fn(),
  getCityCounts: vi.fn(),
  getCategoryCounts: vi.fn(async () => null),
}));

vi.mock('@/lib/jobs', () => ({
  getJobs,
  getJobsCount,
  getCityCounts,
  getCategoryCounts,
  isShowingDemoJobs: () => false,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: unknown; children?: unknown }) =>
    `[link:${typeof href === 'string' ? href : JSON.stringify(href)}]${String(children ?? '')}`,
}));
vi.mock('@/components/public/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/public/JobCard', () => ({ JobCard: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({
  PublicSavedJobsProvider: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/components/public/LandingHubGrid', () => ({
  LandingHubGrid: ({ items }: { items: Array<{ href: string }> }) =>
    items.map((item) => `[hub:${item.href}]`).join(''),
}));

const catalog = await import('@/lib/locations/city-landings');
const { cityAliases, nameKey } = await import('@/lib/locations/city-aliases');
const cityPage = await import('@/app/[locale]/(public)/praca/miasto/[city]/page');
const hubPage = await import('@/app/[locale]/(public)/praca/page');

const {
  ADDITIONAL_CITY_LANDING_KEYS,
  CITY_LANDING_KEYS,
  CITY_LANDING_MIN_ACTIVE_JOBS,
  CORE_CITY_LANDING_KEYS,
  cityLandingQualifies,
  linkedCityLandings,
  qualifyingCityLandings,
} = catalog;

const MESSAGES = { pl, nl, fr, en } as const;

/** `slug → name` ze słownika miejscowości (0112) — nazwa kanoniczna, którą zwracają facety. */
function dictionaryNames(): Map<string, string> {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/0112_locations_be_municipalities.sql'),
    'utf8',
  );
  const names = new Map<string, string>();
  for (const match of sql.matchAll(/^\s*\('([a-z-]+)', '([^']+)', '[A-Za-z -]+', /gm)) {
    if (!names.has(match[1]!)) names.set(match[1]!, match[2]!);
  }
  return names;
}

/** Czy nazwa ze słownika jest jedną z nazw miasta (inaczej facet nie policzy ofert miasta). */
function aliasesCoverDictionaryName(aliases: readonly string[], dictionaryName: string): boolean {
  return aliases.some((alias) => nameKey(alias) === nameKey(dictionaryName));
}

beforeEach(() => {
  getJobs.mockReset();
  getJobsCount.mockReset();
  getCityCounts.mockReset();
  getJobs.mockResolvedValue({ jobs: [], total: 0, page: 1, pageSize: 12 });
});

describe('katalog landingów miast (#920)', () => {
  it('= klucze `locations.*` w każdym języku, rdzeń + kolejne miejscowości bez powtórzeń', () => {
    expect(new Set(CITY_LANDING_KEYS).size).toBe(CITY_LANDING_KEYS.length);
    expect(CITY_LANDING_KEYS).toEqual([...CORE_CITY_LANDING_KEYS, ...ADDITIONAL_CITY_LANDING_KEYS]);
    expect(ADDITIONAL_CITY_LANDING_KEYS.length).toBeGreaterThan(0);
    for (const [locale, messages] of Object.entries(MESSAGES)) {
      expect(Object.keys(messages.locations).sort(), locale).toEqual([...CITY_LANDING_KEYS].sort());
    }
  });

  it('każde miasto ma własny opis w każdym języku (nie tylko podmiana nazwy w szablonie)', () => {
    for (const [locale, messages] of Object.entries(MESSAGES)) {
      const landing = messages.landing as Record<string, string>;
      const locations = messages.locations as Record<string, string>;
      const templates = new Set<string>();
      for (const key of CITY_LANDING_KEYS) {
        const text = landing[`city_${key}`];
        expect(text, `${locale}.landing.city_${key}`).toBeTruthy();
        // Opis bez nazwy miasta — gdyby był wspólnym szablonem, zbiór miałby jeden element.
        templates.add(text!.split(locations[key]!).join('{name}'));
      }
      expect(templates.size, locale).toBe(CITY_LANDING_KEYS.length);
    }
  });

  it('klucz = slug słownika miejscowości, a nazwa słownika jest wśród nazw miasta', () => {
    const names = dictionaryNames();
    for (const key of CITY_LANDING_KEYS) {
      const dictionaryName = names.get(key);
      expect(dictionaryName, key).toBeTruthy();
      expect(aliasesCoverDictionaryName(cityAliases(key), dictionaryName!), key).toBe(true);
    }
  });

  it('kontrola ujemna: nazwy bez nazwy słownika nie przechodzą sprawdzenia', () => {
    // „Saint-Nicolas” to inna gmina (prowincja Liège) — nie może być aliasem Sint-Niklaas.
    expect(aliasesCoverDictionaryName(['Saint-Nicolas'], 'Sint-Niklaas')).toBe(false);
    expect(cityAliases('sint-niklaas')).not.toContain('Saint-Nicolas');
  });
});

describe('reguła kwalifikacji', () => {
  it('próg podaży: poniżej progu, brak i nieprawidłowa liczba = nie', () => {
    expect(CITY_LANDING_MIN_ACTIVE_JOBS).toBe(3);
    expect(cityLandingQualifies(3)).toBe(true);
    expect(cityLandingQualifies(40)).toBe(true);
    expect(cityLandingQualifies(2)).toBe(false);
    expect(cityLandingQualifies(0)).toBe(false);
    expect(cityLandingQualifies(null)).toBe(false);
    expect(cityLandingQualifies(undefined)).toBe(false);
    expect(cityLandingQualifies(Number.NaN)).toBe(false);
  });

  it('liczniki znane: tylko kwalifikujące się, w kolejności katalogu (także spoza rdzenia)', () => {
    const counts = { kortrijk: 5, namur: 3, brussels: 9, ghent: 2, wavre: 1 };
    expect(qualifyingCityLandings(counts)).toEqual(['brussels', 'kortrijk', 'namur']);
    expect(linkedCityLandings(counts)).toEqual(['brussels', 'kortrijk', 'namur']);
    expect(linkedCityLandings({})).toEqual([]);
  });

  it('liczniki nieznane (demo/build/awaria): rdzeń, bez kolejnych miejscowości', () => {
    expect(qualifyingCityLandings(null)).toBeNull();
    expect(linkedCityLandings(null)).toEqual(CORE_CITY_LANDING_KEYS);
    expect(linkedCityLandings(null)).not.toContain('namur');
  });
});

describe('strona miasta — metadane i linki', () => {
  const meta = (city: string) =>
    cityPage.generateMetadata({ params: Promise.resolve({ locale: 'fr', city }) });

  it('nowa miejscowość z ofertami powyżej progu: indeksowalna, canonical i hreflang', async () => {
    getJobsCount.mockResolvedValue(3);
    const result = await meta('namur');
    expect(result.robots).toBeUndefined();
    expect(result.alternates?.canonical).toMatch(/\/fr\/praca\/miasto\/namur$/);
    expect(Object.keys(result.alternates?.languages ?? {})).toEqual(['pl', 'nl', 'fr', 'en', 'x-default']);
    const [args] = getJobsCount.mock.calls[0]!;
    expect(new Set(args.locations)).toEqual(new Set(['Namur', 'Namen']));
  });

  it('kontrola ujemna: poniżej progu (2 oferty) = noindex, follow, bez canonical', async () => {
    getJobsCount.mockResolvedValue(2);
    const result = await meta('namur');
    expect(result.robots).toEqual({ index: false, follow: true });
    expect(result.alternates).toBeUndefined();
  });

  it('klucz spoza katalogu (np. miejscowość tylko ze słownika) = noindex, bez licznika', async () => {
    const result = await meta('halle');
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(getJobsCount).not.toHaveBeenCalled();
  });

  it('nowa miejscowość jest w statycznych parametrach każdego języka', () => {
    const params = cityPage.generateStaticParams();
    expect(params).toEqual(expect.arrayContaining([{ locale: 'nl', city: 'namur' }, { locale: 'en', city: 'wavre' }]));
  });

  it('„Inne miasta” linkują tylko landingi powyżej progu', async () => {
    getCityCounts.mockResolvedValue({ namur: 4, ghent: 2, antwerp: 7, mons: 3 });
    const html = renderToStaticMarkup(
      await cityPage.default({ params: Promise.resolve({ locale: 'nl', city: 'mons' }) }),
    );
    expect(html).toContain('[link:/praca/miasto/antwerp]');
    expect(html).toContain('[link:/praca/miasto/namur]');
    expect(html).not.toContain('[link:/praca/miasto/ghent]');
    expect(html).not.toContain('[link:/praca/miasto/mons]');
    expect(getCityCounts).toHaveBeenCalledWith('nl', CITY_LANDING_KEYS);
  });
});

describe('hub /praca', () => {
  const render = async () =>
    renderToStaticMarkup(await hubPage.default({ params: Promise.resolve({ locale: 'pl' }) }));

  it('liczniki znane: kafle tylko kwalifikujących się miast (także nowych)', async () => {
    getCityCounts.mockResolvedValue({ brussels: 12, ghent: 2, zaventem: 5 });
    const html = await render();
    expect(html).toContain('[hub:/praca/miasto/brussels]');
    expect(html).toContain('[hub:/praca/miasto/zaventem]');
    expect(html).not.toContain('[hub:/praca/miasto/ghent]');
    expect(html).not.toContain('[hub:/praca/miasto/kortrijk]');
    expect(getCityCounts).toHaveBeenCalledWith('pl', CITY_LANDING_KEYS);
  });

  it('żadne miasto nie przekracza progu: komunikat zamiast pustej siatki', async () => {
    getCityCounts.mockResolvedValue({ brussels: 1 });
    const html = await render();
    expect(html).not.toContain('[hub:/praca/miasto/');
    expect(html).toContain('byCityEmpty');
  });

  it('liczniki nieznane: rdzeń katalogu jak dotąd, bez nowych miejscowości', async () => {
    getCityCounts.mockResolvedValue(null);
    const html = await render();
    for (const key of CORE_CITY_LANDING_KEYS) expect(html).toContain(`[hub:/praca/miasto/${key}]`);
    expect(html).not.toContain('[hub:/praca/miasto/namur]');
  });
});
