import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecommendedJobs } from '@/lib/data/candidate';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const CANDIDATE = '11111111-1111-4111-8111-111111111111';
const job = { id: 'job-1', slug: 'magazynier', title: 'Magazynier', company_name: 'Firma', city: 'Gent' };

function db({ matches = [], publicJobs = [], byIds, matchError = null }: {
  matches?: Array<{ job_id: string; score: number }>;
  /** Najnowsze oferty (`get_public_jobs`, fallback). */
  publicJobs?: typeof job[];
  /** Publicznie widoczne oferty dostępne po ID (`get_public_jobs_by_ids`); domyślnie = publicJobs. */
  byIds?: typeof job[];
  matchError?: Error | null;
} = {}) {
  resetFakeDb({ id: CANDIDATE, role: 'candidate' });
  const visible = byIds ?? publicJobs;
  fakeDb
    .rows('candidate.recommended-matches', ({ values }) => {
      if (matchError) throw matchError;
      return matches.slice(0, values[1] as number);
    })
    .rows('candidate.saved-job-ids', [])
    .rpc('get_public_jobs_by_ids', ({ args }: { args: Record<string, unknown> }) => visible.filter((j) => (args['p_ids'] as string[]).includes(j.id)))
    .rpc('get_public_jobs', publicJobs);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('polecane oferty kandydata', () => {
  it('zwraca dopasowaną ofertę i odczytuje wyłącznie dane pod sesją kandydata', async () => {
    db({ matches: [{ job_id: 'job-1', score: 87 }], publicJobs: [job] });

    expect(await getRecommendedJobs('pl', true)).toEqual([{
      id: 'job-1', slug: 'magazynier', title: 'Magazynier', companyName: 'Firma', city: 'Gent', match: 87, saved: false,
    }]);
    expect(fakeDb.callsTo('candidate.recommended-matches')[0]).toMatchObject({ as: CANDIDATE, values: [CANDIDATE, 50] });
    expect(fakeDb.callsTo('candidate.saved-job-ids')[0]).toMatchObject({ as: CANDIDATE, values: [CANDIDATE] });
    expect(fakeDb.callsTo('get_public_jobs_by_ids')[0]!.args).toEqual({ p_ids: ['job-1'], p_locale: 'pl' });
    // Są dopasowania → bez odczytu listy najnowszych (fallback).
    expect(fakeDb.callsTo('get_public_jobs')).toHaveLength(0);
  });

  it('starsza oferta spoza 100 najnowszych z najwyższym score wyprzedza nowsze (#196)', async () => {
    const newest = Array.from({ length: 101 }, (_, i) => ({ ...job, id: `new-${i}`, slug: `new-${i}`, title: `Nowa ${i}` }));
    const old = { ...job, id: 'old-best', slug: 'stara', title: 'Stara, najlepsza' };
    db({
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
    expect(fakeDb.callsTo('get_public_jobs_by_ids')[0]!.args).toEqual({
      p_ids: ['old-best', 'gone', 'new-3'], p_locale: 'fr',
    });
    expect(fakeDb.callsTo('get_public_jobs')).toHaveLength(0);
    // Deterministyczna kolejność: score malejąco, job_id jako rozstrzygnięcie.
    expect(fakeDb.callsTo('candidate.recommended-matches')[0]!.text).toContain('ORDER BY score DESC, job_id ASC');
  });

  it('gdy żadne dopasowanie nie jest już publiczne → fallback najnowszych bez procentu', async () => {
    db({ matches: [{ job_id: 'gone', score: 99 }], publicJobs: [job], byIds: [job] });
    await expect(getRecommendedJobs('pl', true)).resolves.toMatchObject([{ id: 'job-1', match: null }]);
    expect(fakeDb.callsTo('get_public_jobs')[0]!.args).toMatchObject({ p_locale: 'pl', p_limit: 100, p_offset: 0 });
  });

  it('fallback pomija oferty, których RPC po ID nie zwraca pod sesją (firma zablokowana, #97)', async () => {
    const blocked = { ...job, id: 'job-blocked', slug: 'zablokowana', company_name: 'Zablokowana' };
    db({ publicJobs: [blocked, job], byIds: [job] });
    const result = await getRecommendedJobs('pl', true);
    expect(result.map((r) => r.id)).toEqual(['job-1']);
    expect(fakeDb.callsTo('get_public_jobs_by_ids').map((call) => call.args)).toContainEqual({
      p_ids: ['job-blocked', 'job-1'], p_locale: 'pl',
    });
  });

  it('bez dopasowań pokazuje najnowszą publiczną ofertę bez wymyślonego procentu', async () => {
    db({ publicJobs: [job] });
    await expect(getRecommendedJobs('nl', true)).resolves.toMatchObject([{ match: null, title: 'Magazynier' }]);
  });

  it('odróżnia pustą listę od błędu odczytu dla ekranu, zachowując bezpieczny fallback w pulpicie', async () => {
    db();
    await expect(getRecommendedJobs('pl', true)).resolves.toEqual([]);

    const readError = pgError('XX000', 'read-failed');
    db({ matchError: readError });
    await expect(getRecommendedJobs('pl', true)).rejects.toBe(readError);
    await expect(getRecommendedJobs('pl')).resolves.toEqual([]);
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'candidate.getRecommendedJobs' });
  });
});
