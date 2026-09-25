import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSimilarJobs } from '@/lib/jobs';
import { captureError } from '@/lib/error-report';

/**
 * #191: odczyt podobnych ofert zwraca jawny wynik. Awaria listy lub licznika nie rzuca
 * wyjątku (nie przerywa strony szczegółu), a „brak podobnych” oznacza wyłącznie udany pusty odczyt.
 */

const adapters = vi.hoisted(() => ({ list: vi.fn(), pool: {} }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({ getPublicJobs: adapters.list }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const row = (slug: string) => ({ id: slug, slug, title: slug, published_at: '2026-01-01T00:00:00Z', category: 'warehouse' });
const current = { slug: 'biezaca', category: 'warehouse' as const };

describe('getSimilarJobs (#191)', () => {
  it('błąd odczytu → status error, zarejestrowany, bez wyjątku', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    const failure = new Error('count failed');
    adapters.list.mockRejectedValue(failure);

    await expect(getSimilarJobs(current, 'pl', 3)).resolves.toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'jobs.getSimilarJobs' });
  });

  it('udany pusty odczyt → ok z pustą listą (nie błąd)', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 4 });

    await expect(getSimilarJobs(current, 'pl', 3)).resolves.toEqual({ status: 'ok', jobs: [] });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('udany odczyt → ta sama kategoria, bez bieżącej oferty, najwyżej limit', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.list.mockResolvedValue({
      rows: [row('a'), row('biezaca'), row('b'), row('c')],
      total: 4, page: 1, pageSize: 4,
    });

    const result = await getSimilarJobs(current, 'nl', 3);

    expect(adapters.list).toHaveBeenCalledWith(adapters.pool, expect.objectContaining({ locale: 'nl', category: 'warehouse', page: 1, pageSize: 4 }), null);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.jobs.map((job) => job.slug)).toEqual(['a', 'b', 'c']);
  });
});
