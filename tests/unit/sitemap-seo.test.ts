import { describe, expect, it, vi } from 'vitest';

/**
 * Sitemap (#299, #301): landingi tylko z ≥1 ofertą (per język dla miast — filtr po nazwie),
 * szczegóły ofert tylko w językach z tłumaczeniem treści.
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
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => (key: string) =>
    key === 'kortrijk' && locale === 'nl' ? 'Kortrijk' : key === 'kortrijk' ? 'Courtrai' : key,
}));

const { default: sitemap } = await import('@/app/sitemap');

function job(id: string) {
  return { id, slug: `oferta-${id}`, publishedAt: '2026-09-01T00:00:00.000Z' };
}

describe('sitemap', () => {
  it('pomija puste landingi i nieistniejące tłumaczenia ofert', async () => {
    jobs.getCategoryCounts.mockResolvedValue({ construction: 2 });
    // #189: licznik per klucz miasta — oferta w Kortrijk jest na landingu w każdym języku.
    jobs.getCityCounts.mockImplementation(async (_locale: string, keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, key === 'kortrijk' ? 1 : 0])),
    );
    jobs.getJobs.mockResolvedValue({ jobs: [job('a'), job('b')], total: 2, page: 1, pageSize: 100 });
    jobs.getJobsAvailableLocales.mockResolvedValue({ a: ['nl'], b: ['pl', 'nl', 'fr', 'en'] });

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

  it('nieznane języki tłumaczeń (błąd odczytu) = wszystkie wersje, jak dotąd', async () => {
    jobs.getJobsAvailableLocales.mockResolvedValue(null);
    jobs.getJobs.mockResolvedValue({ jobs: [job('a')], total: 1, page: 1, pageSize: 100 });
    const urls = (await sitemap({ id: 1 })).map((entry) => entry.url).filter((url) => url.includes('/oferta-a'));
    expect(urls).toHaveLength(4);
  });
});
