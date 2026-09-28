import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecommendedJobs } from '@/lib/data/candidate';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
import { withRecruitmentMode } from '../helpers/portal-mode';

// Przepływ rekrutacyjny (#1128): w trybie ogłoszeniowym ta ścieżka jest wyłączona.
withRecruitmentMode();

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const CANDIDATE = '11111111-1111-4111-8111-111111111111';
const job = { id: 'job-1', slug: 'magazynier', title: 'Magazynier', company_name: 'Firma', city: 'Gent' };

type MatchRow = {
  job_id: string;
  score: number;
  mandatory_met?: number;
  mandatory_total?: number;
  strengths?: string[];
};

function db({ matches = [], publicJobs = [], byIds, matchError = null, applications = [] }: {
  matches?: MatchRow[];
  /** Własne zgłoszenia kandydata (`candidate.recommended-applications`). */
  applications?: Array<{ job_id: string; id: string }>;
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
    .rows('candidate.recommended-applications', ({ values }) =>
      applications.filter((a) => (values[1] as string[]).includes(a.job_id)))
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
      explanation: { summaryKey: 'good', mandatory: null, strengths: [] },
      applicationId: null,
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

  it('wyjaśnienie dopasowania z zapisanego wiersza: etykieta z procentu, wymagania, tylko znane atuty', async () => {
    db({
      matches: [
        { job_id: 'job-1', score: 62, mandatory_met: 2, mandatory_total: 3, strengths: ['<b>obcy</b>', 'localCandidate', 'localCandidate', 'immediateStart', 'ownTransport'] },
        // Niespójne liczby z bazy (met > total) → pole ukryte, nie „4 z 3”.
        { job_id: 'job-2', score: 91, mandatory_met: 4, mandatory_total: 3, strengths: [] },
      ],
      publicJobs: [job, { ...job, id: 'job-2', slug: 'kierowca' }],
    });
    const result = await getRecommendedJobs('pl', true);
    expect(result.map((r) => [r.id, r.explanation])).toEqual([
      ['job-1', { summaryKey: 'partial', mandatory: { met: 2, total: 3 }, strengths: ['localCandidate', 'immediateStart'] }],
      ['job-2', { summaryKey: 'good', mandatory: null, strengths: [] }],
    ]);
    expect(fakeDb.callsTo('candidate.recommended-matches')[0]!.text).toContain('mandatory_met, mandatory_total, strengths');
  });

  it('oferta z własnym zgłoszeniem niesie id zgłoszenia; zapytanie tylko o pokazane oferty kandydata', async () => {
    db({
      matches: [{ job_id: 'job-1', score: 80 }, { job_id: 'job-2', score: 70 }],
      publicJobs: [job, { ...job, id: 'job-2', slug: 'kierowca' }],
      applications: [{ job_id: 'job-2', id: 'app-2' }, { job_id: 'job-other', id: 'app-x' }],
    });
    const result = await getRecommendedJobs('pl', true);
    expect(result.map((r) => [r.id, r.applicationId])).toEqual([['job-1', null], ['job-2', 'app-2']]);
    const call = fakeDb.callsTo('candidate.recommended-applications')[0]!;
    expect(call).toMatchObject({ as: CANDIDATE, values: [CANDIDATE, ['job-1', 'job-2']] });
    // RLS 0039 wpuszcza też rekrutera firmy — filtr własności i soft-delete musi być jawny.
    expect(call.text).toContain('candidate_id = $1');
    expect(call.text).toContain('deleted_at IS NULL');
  });

  it('fallback najnowszych też oznacza oferty z własnym zgłoszeniem, bez wymyślonego wyjaśnienia', async () => {
    db({ publicJobs: [job], applications: [{ job_id: 'job-1', id: 'app-1' }] });
    await expect(getRecommendedJobs('en', true)).resolves.toMatchObject([
      { id: 'job-1', match: null, explanation: null, applicationId: 'app-1' },
    ]);
  });

  it('pusta lista polecanych nie pyta o zgłoszenia', async () => {
    db();
    await getRecommendedJobs('pl', true);
    expect(fakeDb.callsTo('candidate.recommended-applications')).toHaveLength(0);
  });
});
