import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1115 (DVP-04): okno cutoveru — `APP_MODE=production` bywa ustawione, zanim zniknie bramka
 * hasła (`SITE_ACCESS_PASSWORD`). Wtedy robots.txt i sitemapy nie mogą zapraszać robotów na
 * strony, które zwracają 503 z formularzem hasła. Po zdjęciu bramki indeksowanie wraca od razu
 * (lista partii nie zostaje w cache z okresu bramki).
 */

const state = vi.hoisted(() => ({ production: true }));
const jobs = vi.hoisted(() => ({
  getJobs: vi.fn(),
  getCategoryCounts: vi.fn(),
  getCityCounts: vi.fn(),
  getJobsAvailableLocales: vi.fn(),
  getJobsCount: vi.fn(),
}));
// #1042: sitemap ofert czyta granice partii i strony kursorem (`@/lib/sitemap-jobs`), nie `getJobs`.
const sitemapJobs = vi.hoisted(() => ({
  getSitemapJobShardStarts: vi.fn(),
  getSitemapJobsShard: vi.fn(),
  getSitemapCompanySlugs: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: { siteUrl: 'https://pracuj.be' },
  isProductionDeployment: () => state.production,
}));
vi.mock('@/lib/jobs', () => jobs);
vi.mock('@/lib/sitemap-jobs', () => ({ SITEMAP_JOBS_PAGE: 1000, ...sitemapJobs }));

const { default: sitemap, generateSitemaps } = await import('@/app/sitemap');
const { default: robots } = await import('@/app/robots');
const { isSearchIndexingEnabled } = await import('@/lib/seo/indexing');

const SITE = 'https://pracuj.be';

beforeEach(() => {
  vi.clearAllMocks();
  state.production = true;
  jobs.getCategoryCounts.mockResolvedValue({});
  jobs.getCityCounts.mockResolvedValue({});
  jobs.getJobs.mockResolvedValue({ jobs: [], page: 1, pageSize: 100 });
  jobs.getJobsCount.mockResolvedValue(12_000);
  jobs.getJobsAvailableLocales.mockResolvedValue(null);
  // 12 000 ofert po 5000 na partię = 3 granice partii.
  sitemapJobs.getSitemapJobShardStarts.mockResolvedValue([
    { shardIndex: 1, after: null },
    { shardIndex: 2, after: { publishedAt: '2026-09-01T00:00:00.000000Z', id: 'b' } },
    { shardIndex: 3, after: { publishedAt: '2026-08-01T00:00:00.000000Z', id: 'c' } },
  ]);
  sitemapJobs.getSitemapJobsShard.mockResolvedValue([]);
  sitemapJobs.getSitemapCompanySlugs.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('indeksowanie przy bramce hasła (#1115)', () => {
  it('produkcja + bramka: robots = Disallow: / bez sitemap, sitemap pusty, bez odczytu ofert', async () => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', 'haslo-przed-startem');
    expect(isSearchIndexingEnabled()).toBe(false);
    expect(await robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    expect(await sitemap({ id: 0 })).toEqual([]);
    expect(await sitemap({ id: 1 })).toEqual([]);
    expect(jobs.getJobsCount).not.toHaveBeenCalled();
    expect(jobs.getJobs).not.toHaveBeenCalled();
    expect(sitemapJobs.getSitemapJobShardStarts).not.toHaveBeenCalled();
    expect(sitemapJobs.getSitemapJobsShard).not.toHaveBeenCalled();
  });

  it('hasło z samych białych znaków = bramka wyłączona (jak middleware)', () => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', '   ');
    expect(isSearchIndexingEnabled()).toBe(true);
  });

  it('po zdjęciu bramki lista partii jest liczona od nowa (nie zostaje z okresu bramki)', async () => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', 'haslo-przed-startem');
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    vi.stubEnv('SITE_ACCESS_PASSWORD', '');
    expect(await generateSitemaps()).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]);
    const result = await robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    expect(rules.allow).toBe('/');
    expect(result.sitemap).toContain(`${SITE}/sitemap/3.xml`);
  });

  it('kontrola ujemna: produkcja bez bramki indeksuje, nie-produkcja nie indeksuje nawet bez bramki', async () => {
    expect(isSearchIndexingEnabled()).toBe(true);
    const result = await robots();
    expect(Array.isArray(result.rules) ? result.rules[0]!.allow : result.rules.allow).toBe('/');
    state.production = false;
    expect(isSearchIndexingEnabled()).toBe(false);
    expect(await robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
});
