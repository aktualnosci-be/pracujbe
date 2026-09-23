import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJobs, getJobBySlug, getCategoryCounts, getCityCounts } from '@/lib/jobs';

const adapters = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  categoryCounts: vi.fn(),
  cityCounts: vi.fn(),
  filterFacets: vi.fn(),
  pool: {},
}));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({
  getPublicJobs: adapters.list,
  getPublicJob: adapters.detail,
  getPublicJobCategoryCounts: adapters.categoryCounts,
  getPublicJobCityCounts: adapters.cityCounts,
  getPublicJobFilterFacets: adapters.filterFacets,
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('Publiczne oferty po przełączeniu na PostgreSQL', () => {
  it('brak konfiguracji w produkcji nie publikuje ofert demo', async () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('DATABASE_APP_URL', '');
    await expect(getJobs({ locale: 'pl' })).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(getJobBySlug('demo', 'pl')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(adapters.list).not.toHaveBeenCalled();
  });
  it('przekazuje filtry do PostgreSQL i mapuje rzeczywiste dane bez Supabase', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({ rows: [{ id: 'id', slug: 'oferta', title: 'Elektryk', published_at: '2026-01-01T00:00:00Z', salary_min: 18.59, salary_period: 'hour' }], total: 17, page: 2, pageSize: 12 });
    const result = await getJobs({ locale: 'nl', page: 2, keyword: 'Elektryk' });
    expect(adapters.list).toHaveBeenCalledWith(adapters.pool, { locale: 'nl', page: 2, keyword: 'Elektryk', pageSize: 12 });
    expect(result).toMatchObject({ total: 17, page: 2, jobs: [{ title: 'Elektryk', salaryMin: 18.59, salaryPeriod: 'hour', publishedAt: '2026-01-01T00:00:00Z' }] });
  });
  it.each([
    ['stary wiersz RPC bez pola', {}],
    ['wiersz RPC z nieznanym okresem', { salary_period: 'week' }],
  ])('%s nie zgaduje okresu miesięcznego', async (_case, periodFields) => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({
      rows: [{ id: 'legacy', slug: 'stara-oferta', title: 'Elektryk', published_at: '2026-01-01T00:00:00Z', salary_min: 18.59, ...periodFields }],
      total: 1, page: 1, pageSize: 12,
    });

    const result = await getJobs({ locale: 'pl' });

    expect(result.jobs[0]).not.toHaveProperty('salaryPeriod');
  });
  it('awaria skonfigurowanej bazy nie wraca do demo', async () => {
    vi.stubEnv('APP_MODE', 'demo');
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockRejectedValue(new Error('database unavailable'));
    await expect(getJobs({ locale: 'pl' })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('brak oferty w bazie pozostaje brakiem oferty', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.detail.mockResolvedValue(null);
    expect(await getJobBySlug('missing', 'fr')).toBeNull();
  });
  it('liczniki używają tych samych filtrów bazy co lista', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.categoryCounts.mockResolvedValue({ construction: 204, transport: 7 });
    adapters.filterFacets.mockResolvedValue({
      locations: [
        { city: 'Brussels', count: 100 },
        { city: 'Bruxelles', count: 22 },
        { city: 'Antwerpen', count: 31 },
        { city: 'Brussels-Capital', count: 5 },
      ],
    });

    expect(await getCategoryCounts('pl', ['construction', 'transport'])).toEqual({
      construction: 204,
      transport: 7,
    });
    // #189: licznik per klucz miasta sumuje dokładne aliasy; nierozpoznana nazwa nie jest doliczana.
    expect(await getCityCounts('pl', ['brussels', 'antwerp', 'liege'])).toEqual({
      brussels: 122,
      antwerp: 31,
      liege: 0,
    });
    expect(adapters.categoryCounts).toHaveBeenCalledTimes(1);
    expect(adapters.categoryCounts).toHaveBeenCalledWith(adapters.pool, [
      'construction',
      'transport',
    ]);
    expect(adapters.filterFacets).toHaveBeenCalledTimes(1);
    expect(adapters.filterFacets).toHaveBeenCalledWith(adapters.pool, { locale: 'pl' });
  });
});
