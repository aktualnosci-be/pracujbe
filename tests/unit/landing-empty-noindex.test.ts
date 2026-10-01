import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #299: pusty landing kategorii/miasta (0 ofert) ma `noindex, follow` i nie deklaruje
 * canonical/hreflang; landing z ofertami pozostaje indeksowalny. Licznik używa tego samego
 * filtra co treść strony (kategoria; miasto po wszystkich swoich nazwach — #189, #1119).
 */

const { getJobs, getJobsCount, getCityCounts } = vi.hoisted(() => ({
  getJobs: vi.fn(),
  getJobsCount: vi.fn(),
  getCityCounts: vi.fn(async () => null),
}));

vi.mock('@/lib/jobs', () => ({ getJobs, getJobsCount, getCityCounts, isShowingDemoJobs: () => false }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('@/components/public/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/public/JobCard', () => ({ JobCard: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({ PublicSavedJobsProvider: () => null }));

const { cityAliases } = await import('@/lib/locations/city-aliases');
const category = await import('@/app/[locale]/(public)/praca/kategoria/[category]/page');
const city = await import('@/app/[locale]/(public)/praca/miasto/[city]/page');

beforeEach(() => {
  getJobs.mockReset();
  getJobsCount.mockReset();
});

describe.each([
  ['kategoria', () => category.generateMetadata({ params: Promise.resolve({ locale: 'nl', category: 'cleaning' }) }), { category: 'cleaning' }],
  ['miasto', () => city.generateMetadata({ params: Promise.resolve({ locale: 'nl', city: 'kortrijk' }) }), { locations: cityAliases('kortrijk') }],
])('landing %s', (_name, metadata, filter) => {
  it('bez ofert: noindex, follow i brak canonical/hreflang', async () => {
    getJobsCount.mockResolvedValue(0);
    const meta = await metadata();
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toBeUndefined();
    expect(getJobsCount).toHaveBeenCalledWith(expect.objectContaining({ locale: 'nl', ...filter }));
    // #1230: metadane liczą sam licznik — bez odczytu listy ofert.
    expect(getJobs).not.toHaveBeenCalled();
  });

  it('z ofertami: indeksowalny, z canonical i hreflang', async () => {
    getJobsCount.mockResolvedValue(3);
    const meta = await metadata();
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toMatch(/\/nl\/praca\/(kategoria\/cleaning|miasto\/kortrijk)$/);
    expect(Object.keys(meta.alternates?.languages ?? {})).toEqual(['pl', 'nl', 'fr', 'en', 'x-default']);
  });
});

describe('landing miasta — licznik indeksowalności = filtr treści strony (#1119)', () => {
  it('metadane nie liczą miasta tekstem po nazwie w języku strony', async () => {
    getJobsCount.mockResolvedValue(1);
    await city.generateMetadata({ params: Promise.resolve({ locale: 'fr', city: 'brussels' }) });
    const [args] = getJobsCount.mock.calls[0]!;
    expect(args).not.toHaveProperty('city');
    expect(new Set(args.locations)).toEqual(new Set(cityAliases('brussels')));
  });

  it('treść strony pyta o ten sam zbiór miejsc co metadane', async () => {
    getJobsCount.mockResolvedValue(0);
    getJobs.mockResolvedValue({ jobs: [], total: 0, page: 1, pageSize: 12 });
    await city.generateMetadata({ params: Promise.resolve({ locale: 'nl', city: 'ghent' }) });
    await city.default({ params: Promise.resolve({ locale: 'nl', city: 'ghent' }) });
    const [meta] = getJobsCount.mock.calls[0]!;
    const [body] = getJobs.mock.calls[0]!;
    expect(meta.locations).toEqual(body.locations);
    expect(meta).not.toHaveProperty('city');
  });
});
