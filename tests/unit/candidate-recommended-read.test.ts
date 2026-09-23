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

function client({ matches = [], publicJobs = [], matchError = null }: {
  matches?: Array<{ job_id: string; score: number }>;
  publicJobs?: typeof job[];
  matchError?: object | null;
} = {}) {
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
    rpc: vi.fn(async () => ({ data: publicJobs, error: null })),
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
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_jobs', expect.objectContaining({ p_locale: 'pl' }));
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
