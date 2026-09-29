import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SITEMAP_CACHE_TTL_MS, clearSitemapCaches } from '@/lib/cache/sitemap-cache';

/**
 * #1042 (krok 1, bez migracji): sitemap zostaje `force-dynamic` (build nie czyta bazy), ale
 * wynik każdego pliku i lista partii są trzymane w pamięci procesu przez 3600 s, z deduplikacją
 * równoległych obliczeń. Powtarzane anonimowe żądania nie liczą ofert za każdym razem.
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

const { default: sitemap, generateSitemaps } = await import('@/app/sitemap');
const sitemapModule = await import('@/app/sitemap');

const job = { id: 'a', slug: 'oferta-a', publishedAt: '2026-09-01T00:00:00.000Z' };

beforeEach(() => {
  clearSitemapCaches();
  for (const fn of Object.values(jobs)) fn.mockReset();
  jobs.getCategoryCounts.mockResolvedValue({});
  jobs.getCityCounts.mockResolvedValue({});
  jobs.getJobs.mockResolvedValue({ jobs: [job], total: 1, page: 1, pageSize: 100 });
  jobs.getJobsAvailableLocales.mockResolvedValue({ a: ['pl', 'nl', 'fr', 'en'] });
});

describe('cache sitemap (#1042)', () => {
  it('okres odświeżania to 3600 s, a plik nadal jest generowany per żądanie (nie w buildzie)', () => {
    expect(SITEMAP_CACHE_TTL_MS).toBe(3_600_000);
    expect(sitemapModule.dynamic).toBe('force-dynamic');
  });

  it('powtórzone żądania tego samego pliku nie odpytują bazy ponownie', async () => {
    const first = await sitemap({ id: 1 });
    const callsAfterFirst = jobs.getJobs.mock.calls.length;
    const second = await sitemap({ id: 1 });
    await sitemap({ id: '1' });
    expect(second).toEqual(first);
    expect(jobs.getJobs.mock.calls.length).toBe(callsAfterFirst);
    expect(jobs.getJobsAvailableLocales).toHaveBeenCalledTimes(1);
  });

  it('kontrola ujemna: po wyczyszczeniu cache (lub innym pliku) baza jest odpytywana', async () => {
    await sitemap({ id: 1 });
    const before = jobs.getJobs.mock.calls.length;
    clearSitemapCaches();
    await sitemap({ id: 1 });
    expect(jobs.getJobs.mock.calls.length).toBeGreaterThan(before);
    await sitemap({ id: 0 });
    expect(jobs.getCategoryCounts).toHaveBeenCalledTimes(1);
  });

  it('równoległe żądania czekają na jedno obliczenie (single-flight)', async () => {
    await Promise.all(Array.from({ length: 8 }, () => sitemap({ id: 1 })));
    expect(jobs.getJobsAvailableLocales).toHaveBeenCalledTimes(1);
    await Promise.all(Array.from({ length: 8 }, () => generateSitemaps()));
    await Promise.all(Array.from({ length: 8 }, () => generateSitemaps()));
    // Jedno zapytanie licznikowe na listę partii, niezależnie od liczby żądań (także robots.txt).
    const probeCalls = jobs.getJobs.mock.calls.filter(([params]) => params?.pageSize === 1);
    expect(probeCalls).toHaveLength(1);
  });

  it('błąd odczytu nie jest cache’owany — kolejne żądanie próbuje ponownie', async () => {
    jobs.getCategoryCounts.mockResolvedValueOnce(null);
    await expect(sitemap({ id: 0 })).rejects.toThrow('brak liczników kategorii');
    await expect(sitemap({ id: 0 })).resolves.toBeInstanceOf(Array);
    expect(jobs.getCategoryCounts).toHaveBeenCalledTimes(2);
  });

  it('wynik zdegradowany (nieznane języki tłumaczeń) nie zostaje w cache', async () => {
    jobs.getJobsAvailableLocales.mockResolvedValueOnce(null);
    const degraded = await sitemap({ id: 1 });
    expect(degraded.filter((entry) => entry.url.includes('/oferta-a'))).toHaveLength(4);
    jobs.getJobsAvailableLocales.mockResolvedValue({ a: ['nl'] });
    const recovered = await sitemap({ id: 1 });
    expect(recovered.filter((entry) => entry.url.includes('/oferta-a'))).toHaveLength(1);
  });
});
