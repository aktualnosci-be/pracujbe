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
  getJobFilterFacets: (params: unknown, viewer?: unknown) => getJobFilterFacets(params, viewer),
  getJobs: (params: unknown, viewer?: unknown) => getJobs(params, viewer),
}));

// #874: kandydat identyczny z tym, który przekazuje SSR listy ofert (`readCandidateViewerId`).
// Domyślnie gość (`null`); poszczególne testy nadpisują `mockResolvedValueOnce`.
const readCandidateViewerId = vi.fn(async () => null as string | null);
vi.mock('@/lib/auth/candidate-viewer', () => ({
  readCandidateViewerId: () => readCandidateViewerId(),
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
  readCandidateViewerId.mockReset();
  readCandidateViewerId.mockResolvedValue(null);
});

/** Odczekuje kolejkę mikrozadań tyle razy, ile jest asynchronicznych `await` przed agregacją. */
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

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
    await flushMicrotasks();
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

describe('GET /api/job-filter-facets — kontekst kandydata (#874)', () => {
  it('przekazuje zweryfikowanego kandydata z sesji do agregacji facetów i listy demo', async () => {
    readCandidateViewerId.mockResolvedValue('11111111-1111-1111-1111-111111111111');
    getJobFilterFacets.mockResolvedValue(facetsResult(2));
    await GET(request('?locale=pl&immediate=1&keyword=t874a'));
    expect(getJobFilterFacets).toHaveBeenCalledWith(
      expect.objectContaining({ immediate: true }),
      { candidateId: '11111111-1111-1111-1111-111111111111' },
    );
  });

  it('przekazuje kandydata też do zapasowej listy demo (getJobs), gdy baza nie ma agregatu', async () => {
    readCandidateViewerId.mockResolvedValue('22222222-2222-2222-2222-222222222222');
    getJobFilterFacets.mockResolvedValue(null);
    getJobs.mockResolvedValue({ jobs: [], total: 0, page: 1, pageSize: 100, maxPage: 1 });
    await GET(request('?locale=pl&keyword=t874b'));
    expect(getJobs).toHaveBeenCalledWith(
      expect.any(Object),
      { candidateId: '22222222-2222-2222-2222-222222222222' },
    );
  });

  it('ten sam filtr, RÓŻNI kandydaci → OSOBNA agregacja (blokady firm jednego konta nie trafiają do drugiego)', async () => {
    // Zapytanie unikalne dla tego testu (osobny klucz cache po stronie `keyword`) — jedyna
    // zmienna między trzema wywołaniami jest kandydat z sesji.
    const query = '?locale=pl&immediate=1&keyword=t874c';
    getJobFilterFacets
      .mockResolvedValueOnce(facetsResult(1)) // gość: firma zablokowana przez kandydata A jest widoczna
      .mockResolvedValueOnce(facetsResult(2)) // kandydat A: bez ofert zablokowanej firmy
      .mockResolvedValueOnce(facetsResult(1)); // kandydat B: znów widzi wszystko

    readCandidateViewerId.mockResolvedValueOnce(null);
    const guest = await GET(request(query));

    readCandidateViewerId.mockResolvedValueOnce('11111111-1111-1111-1111-111111111111');
    const candidateA = await GET(request(query));

    readCandidateViewerId.mockResolvedValueOnce('22222222-2222-2222-2222-222222222222');
    const candidateB = await GET(request(query));

    expect(await guest.json()).toMatchObject({ total: 1 });
    expect(await candidateA.json()).toMatchObject({ total: 2 });
    expect(await candidateB.json()).toMatchObject({ total: 1 });
    // Trzy osobne agregacje — bez tej poprawki (klucz cache bez candidateId) druga i trzecia
    // trafiłyby w cache pierwszej i getJobFilterFacets zostałoby wywołane tylko raz.
    expect(getJobFilterFacets).toHaveBeenCalledTimes(3);
  });

  it('kontrola ujemna: ten sam kandydat, drugie żądanie w oknie cache → BEZ nowej agregacji', async () => {
    readCandidateViewerId.mockResolvedValue('11111111-1111-1111-1111-111111111111');
    getJobFilterFacets.mockResolvedValue(facetsResult(4));
    const query = '?locale=pl&immediate=1&keyword=t874d';
    await GET(request(query));
    await GET(request(query));
    expect(getJobFilterFacets).toHaveBeenCalledTimes(1);
  });
});
