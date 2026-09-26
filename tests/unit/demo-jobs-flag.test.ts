import { afterEach, describe, expect, it, vi } from 'vitest';

import { getJobBySlug, getJobs, isShowingDemoJobs } from '@/lib/jobs';

/**
 * #297 (Invariant #12): oferty z zestawu demonstracyjnego są oznaczone `isDemo`, żeby UI
 * nie pokazywało ich jako prawdziwych. Oferty z bazy nigdy nie mają tej flagi.
 */

const adapters = vi.hoisted(() => ({ list: vi.fn(), pool: {} }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({ getPublicJobs: adapters.list }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('oznaczenie ofert demonstracyjnych (#297)', () => {
  it('bez bazy: każda oferta listy i szczegółu ma isDemo, strony pokazują baner', async () => {
    vi.stubEnv('DATABASE_APP_URL', '');
    const { jobs } = await getJobs({ locale: 'pl', pageSize: 100 });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.isDemo === true)).toBe(true);

    const detail = await getJobBySlug(jobs[0]!.slug, 'pl');
    expect(detail?.isDemo).toBe(true);
    expect(isShowingDemoJobs()).toBe(true);
  });

  it('kontrola ujemna: oferty z bazy nie są oznaczone jako demo, bez baneru', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({
      rows: [{ id: 'a', slug: 'a', title: 'A', published_at: '2026-01-01T00:00:00Z', category: 'warehouse' }],
      total: 1, page: 1, pageSize: 12,
    });

    const { jobs } = await getJobs({ locale: 'pl' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).not.toHaveProperty('isDemo');
    expect(isShowingDemoJobs()).toBe(false);
  });
});
