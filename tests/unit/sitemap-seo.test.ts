import { describe, expect, it, vi } from 'vitest';

/**
 * Sitemap (#299, #301): landingi tylko z ≥1 ofertą (per język dla miast — filtr po nazwie),
 * szczegóły ofert tylko w językach z tłumaczeniem treści.
 */

const jobs = vi.hoisted(() => ({
  getCategoryCounts: vi.fn(),
  getCityCounts: vi.fn(),
}));
// #1042: katalog ofert z kursorowych RPC (języki tłumaczeń są częścią wiersza).
const catalog = vi.hoisted(() => ({
  getSitemapJobShardStarts: vi.fn(),
  getSitemapJobsShard: vi.fn(),
  getSitemapCompanySlugs: vi.fn(async () => [] as string[]),
}));

vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' }, isProductionDeployment: () => true }));
vi.mock('@/lib/jobs', () => jobs);
vi.mock('@/lib/sitemap-jobs', () => catalog);
vi.mock('@/lib/guides/guides', () => ({ getAllGuideSlugs: () => [] }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => (key: string) =>
    key === 'kortrijk' && locale === 'nl' ? 'Kortrijk' : key === 'kortrijk' ? 'Courtrai' : key,
}));

const { default: sitemap } = await import('@/app/sitemap');

function job(id: string, locales: string[] = []) {
  return {
    id,
    slug: `oferta-${id}`,
    publishedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    locales,
  };
}

describe('sitemap', () => {
  it('pomija puste landingi i nieistniejące tłumaczenia ofert', async () => {
    jobs.getCategoryCounts.mockResolvedValue({ construction: 2 });
    // #189: licznik per klucz miasta — oferta w Kortrijk jest na landingu w każdym języku.
    jobs.getCityCounts.mockImplementation(async (_locale: string, keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, key === 'kortrijk' ? 1 : 0])),
    );
    catalog.getSitemapJobsShard.mockResolvedValue([job('a', ['nl']), job('b', ['pl', 'nl', 'fr', 'en'])]);

    // id 0 = core (strony statyczne/landingi/poradniki); id 1 = pierwsza (i tu jedyna) partia
    // ofert (#599: sitemap index zamiast jednego pliku).
    const core = await sitemap({ id: 0 });
    const jobsShard = await sitemap({ id: 1 });
    const byPrefix = (entries: typeof core, prefix: string) =>
      entries.map((entry) => entry.url).filter((url) => url.includes(prefix));

    expect(byPrefix(core, '/praca/kategoria/')).toEqual(
      ['pl', 'nl', 'fr', 'en'].map((l) => `https://pracuj.be/${l}/praca/kategoria/construction`),
    );
    expect(byPrefix(core, '/praca/miasto/')).toEqual(
      ['pl', 'nl', 'fr', 'en'].map((l) => `https://pracuj.be/${l}/praca/miasto/kortrijk`),
    );
    expect(byPrefix(jobsShard, '/oferty-pracy/oferta-a')).toEqual([
      'https://pracuj.be/nl/oferty-pracy/oferta-a',
    ]);
    expect(byPrefix(jobsShard, '/oferty-pracy/oferta-b')).toHaveLength(4);

    const entryA = jobsShard.find((entry) => entry.url.endsWith('/oferta-a'));
    expect(entryA?.alternates?.languages).toEqual({
      nl: 'https://pracuj.be/nl/oferty-pracy/oferta-a',
      'x-default': 'https://pracuj.be/nl/oferty-pracy/oferta-a',
    });
  });

  it('oferta bez żadnego tłumaczenia (pusta lista języków) = wszystkie wersje, jak dotąd', async () => {
    catalog.getSitemapJobsShard.mockResolvedValue([job('a', [])]);
    const urls = (await sitemap({ id: 1 })).map((entry) => entry.url).filter((url) => url.includes('/oferta-a'));
    expect(urls).toHaveLength(4);
  });

  // #796: po istotnej edycji opublikowanej oferty `jobs.updated_at` jest nowsze niż
  // `published_at` — sitemap ma to zobaczyć, inaczej Google dostaje przestarzały sygnał.
  it('lastModified odzwierciedla ostatnią istotną edycję (updated_at), nie datę publikacji', async () => {
    catalog.getSitemapJobsShard.mockResolvedValue([
      { ...job('edited'), updatedAt: '2026-09-20T12:00:00.123456+00:00' },
    ]);
    const entry = (await sitemap({ id: 1 })).find((e) => e.url.endsWith('/oferta-edited'));
    expect(entry?.lastModified).toEqual(new Date('2026-09-20T12:00:00.123Z'));
    // Kontrola ujemna: liczenie wyłącznie z `publishedAt` (zachowanie sprzed #796) dałoby 1 września.
    expect(entry?.lastModified).not.toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('lastModified: nieparsowalne updated_at → data publikacji, a przy błędzie obu → bieżący czas', async () => {
    catalog.getSitemapJobsShard.mockResolvedValue([
      { ...job('bad-updated'), updatedAt: 'nie-data' },
      { ...job('bad-both'), updatedAt: 'nie-data', publishedAt: 'nie-data' },
    ]);
    const before = Date.now();
    const entries = await sitemap({ id: 1 });
    expect(entries.find((e) => e.url.endsWith('/oferta-bad-updated'))?.lastModified).toEqual(
      new Date('2026-09-01T00:00:00.000Z'),
    );
    const now = (entries.find((e) => e.url.endsWith('/oferta-bad-both'))?.lastModified as Date).getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});
