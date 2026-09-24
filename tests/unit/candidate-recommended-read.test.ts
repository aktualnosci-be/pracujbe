import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecommendedJobs } from '@/lib/data/candidate';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const job = { id: 'job-1', slug: 'magazynier', title: 'Magazynier', company_name: 'Firma', city: 'Gent' };

function client({ matches = [], publicJobs = [], byIds, matchError = null }: {
  matches?: Array<{ job_id: string; score: number }>;
  /** Najnowsze oferty (`get_public_jobs`, fallback). */
  publicJobs?: typeof job[];
  /** Publicznie widoczne oferty dostępne po ID (`get_public_jobs_by_ids`); domyślnie = publicJobs. */
  byIds?: typeof job[];
  matchError?: object | null;
} = {}) {
  const visible = byIds ?? publicJobs;
  const matchQuery = {
    select: vi.fn(() => matchQuery),
    eq: vi.fn(() => matchQuery),
    order: vi.fn(() => matchQuery),
    limit: vi.fn(async () => ({ data: matches, error: matchError })),
  };
  const savedQuery = {
    select: vi.fn(() => savedQuery),
    eq: vi.fn(async () => ({ data: [], error: null })),
  };
  const supabase = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'candidate-1' } } })) },
    from: vi.fn((table: string) => table === 'matches' ? matchQuery : savedQuery),
    rpc: vi.fn(async (name: string, args: { p_ids?: string[] }) => ({
      data: name === 'get_public_jobs_by_ids'
        ? visible.filter((j) => args.p_ids?.includes(j.id))
        : publicJobs,
      error: null,
    })),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, matchQuery, savedQuery };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('polecane oferty kandydata', () => {
  it('zwraca dopasowaną ofertę i odczytuje wyłącznie dane pod sesją kandydata', async () => {
    const { supabase, matchQuery, savedQuery } = client({
      matches: [{ job_id: 'job-1', score: 87 }], publicJobs: [job],
    });

    expect(await getRecommendedJobs('pl', true)).toEqual([{
      id: 'job-1', slug: 'magazynier', title: 'Magazynier', companyName: 'Firma', city: 'Gent', match: 87, saved: false,
    }]);
    expect(matchQuery.eq).toHaveBeenCalledWith('candidate_id', 'candidate-1');
    expect(savedQuery.eq).toHaveBeenCalledWith('candidate_id', 'candidate-1');
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_jobs_by_ids', { p_ids: ['job-1'], p_locale: 'pl' });
    // Są dopasowania → bez odczytu listy najnowszych (fallback).
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_public_jobs', expect.anything());
  });

  it('starsza oferta spoza 100 najnowszych z najwyższym score wyprzedza nowsze (#196)', async () => {
    const newest = Array.from({ length: 101 }, (_, i) => ({ ...job, id: `new-${i}`, slug: `new-${i}`, title: `Nowa ${i}` }));
    const old = { ...job, id: 'old-best', slug: 'stara', title: 'Stara, najlepsza' };
    const { supabase, matchQuery } = client({
      matches: [
        { job_id: 'old-best', score: 95 },
        { job_id: 'gone', score: 90 }, // wygasła/niezweryfikowana: RPC jej nie zwraca
        { job_id: 'new-3', score: 70 },
      ],
      publicJobs: newest,
      byIds: [...newest, old],
    });

    const result = await getRecommendedJobs('fr', true);
    expect(result.map((r) => [r.id, r.match])).toEqual([['old-best', 95], ['new-3', 70]]);
    expect(result.some((r) => r.id === 'gone')).toBe(false);
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_jobs_by_ids', {
      p_ids: ['old-best', 'gone', 'new-3'], p_locale: 'fr',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_public_jobs', expect.anything());
    // Deterministyczna kolejność: score malejąco, job_id jako rozstrzygnięcie.
    expect(matchQuery.order).toHaveBeenNthCalledWith(1, 'score', { ascending: false });
    expect(matchQuery.order).toHaveBeenNthCalledWith(2, 'job_id', { ascending: true });
  });

  it('gdy żadne dopasowanie nie jest już publiczne → fallback najnowszych bez procentu', async () => {
    client({ matches: [{ job_id: 'gone', score: 99 }], publicJobs: [job], byIds: [job] });
    await expect(getRecommendedJobs('pl', true)).resolves.toMatchObject([{ id: 'job-1', match: null }]);
  });

  it('fallback pomija oferty, których RPC po ID nie zwraca pod sesją (firma zablokowana, #97)', async () => {
    const blocked = { ...job, id: 'job-blocked', slug: 'zablokowana', company_name: 'Zablokowana' };
    const { supabase } = client({ publicJobs: [blocked, job], byIds: [job] });
    const result = await getRecommendedJobs('pl', true);
    expect(result.map((r) => r.id)).toEqual(['job-1']);
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_jobs_by_ids', {
      p_ids: ['job-blocked', 'job-1'], p_locale: 'pl',
    });
  });

  it('bez dopasowań pokazuje najnowszą publiczną ofertę bez wymyślonego procentu', async () => {
    client({ publicJobs: [job] });
    await expect(getRecommendedJobs('nl', true)).resolves.toMatchObject([{ match: null, title: 'Magazynier' }]);
  });

  it('odróżnia pustą listę od błędu odczytu dla ekranu, zachowując bezpieczny fallback w pulpicie', async () => {
    client();
    await expect(getRecommendedJobs('pl', true)).resolves.toEqual([]);

    const readError = { code: 'read-failed' };
    client({ matchError: readError });
    await expect(getRecommendedJobs('pl', true)).rejects.toBe(readError);
    await expect(getRecommendedJobs('pl')).resolves.toEqual([]);
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'candidate.getRecommendedJobs' });
  });
});
