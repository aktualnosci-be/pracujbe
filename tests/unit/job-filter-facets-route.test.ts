// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #595 — publiczny endpoint facetów ofert: limit prób (`checkRateLimit`) przed kosztowną
 * agregacją oraz krótki cache + single-flight (`createTtlSingleFlightCache`), żeby te same
 * filtry w krótkim oknie nie liczyły agregacji od nowa na każde żądanie.
 */

const checkRateLimit = vi.fn(async (_action: string, _opts?: unknown) => true);
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (action: string, opts?: unknown) => checkRateLimit(action, opts),
}));

const getJobFilterFacets = vi.fn();
const getJobs = vi.fn();
vi.mock('@/lib/jobs', () => ({
  getJobFilterFacets: (params: unknown) => getJobFilterFacets(params),
  getJobs: (params: unknown) => getJobs(params),
}));

import { GET } from '@/app/api/job-filter-facets/route';

function facetsResult(total: number) {
  return {
    total,
    categories: {},
    locations: [],
    contracts: {},
    accommodation: { provided: 0, unavailable: 0 },
    immediate: 0,
    noLanguage: 0,
  };
}

function request(query: string): Request {
  return new Request(`https://pracuj.be/api/job-filter-facets${query}`);
}

beforeEach(() => {
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue(true);
  getJobFilterFacets.mockReset();
  getJobs.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/job-filter-facets — limit prób (#595)', () => {
  it('przekroczony limit → 429 z Retry-After, BEZ wywołania agregacji (koszt nie jest ponoszony)', async () => {
    checkRateLimit.mockResolvedValue(false);
    const res = await GET(request('?locale=pl&keyword=kierowca'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(getJobFilterFacets).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(
      'job-filter-facets',
      expect.objectContaining({ max: 60, windowSeconds: 60 }),
    );
  });

  it('w limicie → agregacja się wykonuje', async () => {
    getJobFilterFacets.mockResolvedValue(facetsResult(5));
    const res = await GET(request('?locale=pl'));
    expect(res.status).toBe(200);
    expect(getJobFilterFacets).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/job-filter-facets — cache + single-flight (#595)', () => {
  it('te same filtry w krótkim oknie → jedna agregacja dla wielu żądań (single-flight + cache)', async () => {
    let resolveFacets!: (value: unknown) => void;
    getJobFilterFacets.mockImplementation(
      () => new Promise((resolve) => { resolveFacets = resolve; }),
    );
    const query = '?locale=pl&keyword=magazyn&category=warehouse';
    const first = Promise.all([GET(request(query)), GET(request(query))]);
    await Promise.resolve();
    resolveFacets(facetsResult(11));
    const [r1, r2] = await first;
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(getJobFilterFacets).toHaveBeenCalledTimes(1);

    // Kolejne, oddzielne żądanie z tymi samymi filtrami w tym samym oknie — nadal bez nowej agregacji.
    const r3 = await GET(request(query));
    expect(await r3.json()).toMatchObject({ total: 11 });
    expect(getJobFilterFacets).toHaveBeenCalledTimes(1);
  });

  it('kontrola ujemna: inne filtry → OSOBNA agregacja (cache nie miesza wyników różnych zapytań)', async () => {
    getJobFilterFacets.mockResolvedValueOnce(facetsResult(3)).mockResolvedValueOnce(facetsResult(9));
    const a = await GET(request('?locale=pl&keyword=magazyn'));
    const b = await GET(request('?locale=pl&keyword=kierowca'));
    expect(await a.json()).toMatchObject({ total: 3 });
    expect(await b.json()).toMatchObject({ total: 9 });
    expect(getJobFilterFacets).toHaveBeenCalledTimes(2);
  });
});
