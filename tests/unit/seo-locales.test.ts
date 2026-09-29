import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { routing, type Locale } from '@/i18n/routing';
import { defaultAlternateLocale } from '@/lib/job-content-locale';
import { ogLocale, openGraphLocales, pickXDefaultLocale } from '@/lib/seo/locales';

/**
 * #1084 (og:locale w jednym formacie `język_KRAJ` + `alternateLocale`) i #1097 (jeden wybór
 * `x-default` dla sitemapy i metadata oferty).
 */

const jobs = vi.hoisted(() => ({
  getJobs: vi.fn(),
  getCategoryCounts: vi.fn(),
  getCityCounts: vi.fn(),
  getJobsAvailableLocales: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' }, isProductionDeployment: () => true }));
vi.mock('@/lib/jobs', () => jobs);
vi.mock('@/lib/guides/guides', () => ({ getAllGuideSlugs: () => [] }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

const { default: sitemap } = await import('@/app/sitemap');

describe('og:locale (#1084)', () => {
  it.each([
    ['pl', 'pl_PL'],
    ['nl', 'nl_BE'],
    ['fr', 'fr_BE'],
    ['en', 'en_GB'],
  ])('%s → %s', (locale, expected) => {
    expect(ogLocale(locale)).toBe(expected);
  });

  it('nieznany kod zostaje bez zmian i nie rzuca', () => {
    expect(ogLocale('xx')).toBe('xx');
  });

  it('pozostałe języki serwisu jako alternateLocale (w kolejności routingu, bez bieżącego)', () => {
    expect(openGraphLocales('nl')).toEqual({ locale: 'nl_BE', alternateLocale: ['pl_PL', 'fr_BE', 'en_GB'] });
    expect(openGraphLocales('pl').alternateLocale).toEqual(['nl_BE', 'fr_BE', 'en_GB']);
  });

  it('oferta z ograniczonym zbiorem wersji podaje tylko istniejące alternatywy', () => {
    expect(openGraphLocales('nl', ['nl', 'en'])).toEqual({ locale: 'nl_BE', alternateLocale: ['en_GB'] });
    expect(openGraphLocales('fr', ['fr'])).toEqual({ locale: 'fr_BE', alternateLocale: [] });
  });

  /** Strażnik źródeł: każdy `openGraph` w metadata stron ma ten sam zestaw pól locale. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }
  const OG_BLOCK = /openGraph:\s*\{[\s\S]*?\n\s{4}\},/g;

  function offenders(source: string): string[] {
    return (source.match(OG_BLOCK) ?? []).filter((block) => !block.includes('openGraphLocales('));
  }

  it('wszystkie strony z własnym openGraph używają openGraphLocales (bez surowego kodu języka)', () => {
    const files = sourceFiles(join(process.cwd(), 'src/app/[locale]'));
    const bad = files.flatMap((file) => offenders(readFileSync(file, 'utf8')).map(() => file));
    expect(bad).toEqual([]);
    expect(files.filter((file) => /openGraph:/.test(readFileSync(file, 'utf8'))).length).toBeGreaterThanOrEqual(11);
  });

  it('kontrola ujemna: surowe `locale,` w openGraph jest wykrywane', () => {
    const raw = `alternates: {},\n    openGraph: {\n      type: 'website',\n      locale,\n      title: 'x',\n    },`;
    expect(offenders(raw)).toHaveLength(1);
  });

  it('brak lokalnych kopii mapy OG_LOCALE poza src/lib/seo/locales.ts', () => {
    const files = sourceFiles(join(process.cwd(), 'src')).filter((file) => !file.endsWith('lib/seo/locales.ts'));
    const copies = files.filter((file) => /OG_LOCALE\s*[:=]/.test(readFileSync(file, 'utf8')));
    expect(copies).toEqual([]);
  });
});

describe('x-default oferty (#1097)', () => {
  it('reguła nie zależy od kolejności wejścia (kolejność z bazy ≠ kolejność routingu)', () => {
    expect(pickXDefaultLocale(['en', 'fr', 'nl'])).toBe('nl');
    expect(pickXDefaultLocale(['nl', 'fr', 'en'])).toBe('nl');
    expect(pickXDefaultLocale(['en', 'pl'])).toBe('pl');
    expect(pickXDefaultLocale([])).toBeUndefined();
    // Kontrola ujemna: stara reguła „pierwszy z wejścia” dawała inny wynik dla kolejności alfabetycznej.
    const legacy = (list: readonly string[]) => (list.includes(routing.defaultLocale) ? routing.defaultLocale : list[0]);
    expect(legacy(['en', 'fr', 'nl'])).toBe('en');
  });

  it('sitemap i metadata oferty wskazują ten sam x-default dla oferty bez wersji PL', async () => {
    // Baza zwraca języki alfabetycznie (en, fr, nl); strona układa je wg routingu (nl, fr, en).
    const fromDb: Locale[] = ['en', 'fr', 'nl'];
    jobs.getCategoryCounts.mockResolvedValue({});
    jobs.getCityCounts.mockResolvedValue({});
    jobs.getJobs.mockResolvedValue({
      jobs: [{ id: 'a', slug: 'oferta-a', publishedAt: '2026-09-01T00:00:00.000Z' }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    jobs.getJobsAvailableLocales.mockResolvedValue({ a: fromDb });

    const entries = await sitemap({ id: 1 });
    const entry = entries.find((item) => item.url.endsWith('/oferta-a'));
    const pageLocales = routing.locales.filter((locale) => fromDb.includes(locale));
    const pageXDefault = defaultAlternateLocale(pageLocales);

    expect(pageXDefault).toBe('nl');
    expect(entry?.alternates?.languages?.['x-default']).toBe(`https://pracuj.be/${pageXDefault}/oferty-pracy/oferta-a`);
  });
});
