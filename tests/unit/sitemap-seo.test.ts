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
    // Oferta w Kortrijk pasuje tylko do nazwy NL („Kortrijk”); w innych językach filtr nic nie znajduje.
    jobs.getCityCounts.mockImplementation(async (_locale: string, names: string[]) =>
      Object.fromEntries(names.map((name) => [name, name === 'Kortrijk' ? 1 : 0])),
    );
    jobs.getJobs.mockResolvedValue({ jobs: [job('a'), job('b')], total: 2, page: 1, pageSize: 100 });
    jobs.getJobsAvailableLocales.mockResolvedValue({ a: ['nl'], b: ['pl', 'nl', 'fr', 'en'] });

    const urls = (await sitemap()).map((entry) => entry.url);
    const byPrefix = (prefix: string) => urls.filter((url) => url.includes(prefix));

    expect(byPrefix('/praca/kategoria/')).toEqual(
      ['pl', 'nl', 'fr', 'en'].map((l) => `https://pracuj.be/${l}/praca/kategoria/construction`),
    );
    expect(byPrefix('/praca/miasto/')).toEqual(['https://pracuj.be/nl/praca/miasto/kortrijk']);
    expect(byPrefix('/oferty-pracy/oferta-a')).toEqual(['https://pracuj.be/nl/oferty-pracy/oferta-a']);
    expect(byPrefix('/oferty-pracy/oferta-b')).toHaveLength(4);

    const entryA = (await sitemap()).find((entry) => entry.url.endsWith('/oferta-a'));
    expect(entryA?.alternates?.languages).toEqual({
      nl: 'https://pracuj.be/nl/oferty-pracy/oferta-a',
      'x-default': 'https://pracuj.be/nl/oferty-pracy/oferta-a',
    });
  });

  it('nieznane języki tłumaczeń (błąd odczytu) = wszystkie wersje, jak dotąd', async () => {
    jobs.getJobsAvailableLocales.mockResolvedValue(null);
    const urls = (await sitemap()).map((entry) => entry.url).filter((url) => url.includes('/oferta-a'));
    expect(urls).toHaveLength(4);
  });
});
