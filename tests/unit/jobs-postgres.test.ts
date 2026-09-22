import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJobs, getJobBySlug, getCategoryCounts, getCityCounts } from '@/lib/jobs';

const adapters = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), count: vi.fn(), pool: {} }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({ getPublicJobs: adapters.list, getPublicJob: adapters.detail, getPublicJobsCount: adapters.count }));
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
    adapters.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    expect(await getCategoryCounts('pl', ['construction'])).toEqual({ construction: 4 });
    expect(await getCityCounts('pl', ['Brussels'])).toEqual({ Brussels: 2 });
    expect(adapters.count).toHaveBeenNthCalledWith(1, adapters.pool, { locale: 'pl', categories: ['construction'] });
    expect(adapters.count).toHaveBeenNthCalledWith(2, adapters.pool, { locale: 'pl', city: 'Brussels' });
  });
});
