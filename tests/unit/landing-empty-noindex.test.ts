import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #299: pusty landing kategorii/miasta (0 ofert) ma `noindex, follow` i nie deklaruje
 * canonical/hreflang; landing z ofertami pozostaje indeksowalny. Licznik używa tego samego
 * filtra co treść strony (kategoria; miasto po nazwie w języku strony).
 */

const { getJobs } = vi.hoisted(() => ({ getJobs: vi.fn() }));

vi.mock('@/lib/jobs', () => ({ getJobs }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('@/components/public/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/public/JobCard', () => ({ JobCard: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({ PublicSavedJobsProvider: () => null }));

const category = await import('@/app/[locale]/(public)/praca/kategoria/[category]/page');
const city = await import('@/app/[locale]/(public)/praca/miasto/[city]/page');

const result = (total: number) => ({ jobs: [], total, page: 1, pageSize: 1 });

beforeEach(() => getJobs.mockReset());

describe.each([
  ['kategoria', () => category.generateMetadata({ params: Promise.resolve({ locale: 'nl', category: 'cleaning' }) }), { category: 'cleaning' }],
  ['miasto', () => city.generateMetadata({ params: Promise.resolve({ locale: 'nl', city: 'kortrijk' }) }), { city: 'kortrijk' }],
])('landing %s', (_name, metadata, filter) => {
  it('bez ofert: noindex, follow i brak canonical/hreflang', async () => {
    getJobs.mockResolvedValue(result(0));
    const meta = await metadata();
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toBeUndefined();
    expect(getJobs).toHaveBeenCalledWith(expect.objectContaining({ locale: 'nl', ...filter }));
  });

  it('z ofertami: indeksowalny, z canonical i hreflang', async () => {
    getJobs.mockResolvedValue(result(3));
    const meta = await metadata();
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toMatch(/\/nl\/praca\/(kategoria\/cleaning|miasto\/kortrijk)$/);
    expect(Object.keys(meta.alternates?.languages ?? {})).toEqual(['pl', 'nl', 'fr', 'en', 'x-default']);
  });
});
