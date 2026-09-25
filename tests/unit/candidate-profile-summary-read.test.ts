import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCandidateOverview, getCandidateProfileSummary } from '@/lib/data/candidate';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const OWNER = '11111111-1111-4111-8111-111111111111';
const readError = pgError('XX000', 'read-failed');

const PARTIAL_CANDIDATE = { id: 'candidate-profile-1', experience_years: 3, occupations: ['Magazynier'], categories: [], city: 'Gent', availability: null };
const COMPLETE_CANDIDATE = { ...PARTIAL_CANDIDATE, categories: ['logistics'], availability: 'immediate' };

/** Zapytania podsumowania: imię z `profiles` + profil kandydata z licznikami relacji (jeden wiersz). */
const PROFILE_QUERIES = ['candidate.profile-name', 'candidate.profile-completeness'] as const;

function db(failed?: string, empty = false, candidate: Record<string, unknown> = PARTIAL_CANDIDATE, counts: Record<string, number> = {}) {
  resetFakeDb({ id: OWNER, role: 'candidate' });
  const read = (name: string, row: Record<string, unknown>) => () => {
    if (failed === name) throw readError;
    return empty ? [] : [row];
  };
  fakeDb
    .rows('candidate.profile-name', read('candidate.profile-name', { first_name: 'Anna', last_name: 'Kowalska' }))
    .rows('candidate.profile-completeness', read('candidate.profile-completeness', {
      ...candidate,
      languages_count: counts['candidate_languages'] ?? 0,
      certificates_count: counts['candidate_certificates'] ?? 0,
    }))
    .rpc('get_public_jobs_count', 12)
    .count('candidate.active-applications', 4)
    .count('candidate.unread-conversations', 0);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('podsumowanie profilu kandydata', () => {
  it('liczy ukończenie z rzeczywiście odczytanych pól i relacji', async () => {
    db();
    await expect(getCandidateProfileSummary()).resolves.toMatchObject({
      loadFailed: false, firstName: 'Anna', completionPct: 50,
      checklist: { basicInfo: true, preferences: false, experience: true, location: true, languages: false, availability: false },
    });
    // Oba odczyty pod sesją właściciela, zawężone do jego UUID.
    for (const name of PROFILE_QUERIES) {
      expect(fakeDb.callsTo(name)[0]).toMatchObject({ as: OWNER, values: [OWNER] });
    }
  });

  it('profil z uzupełnionymi wszystkimi krokami kreatora ma 100% (#315)', async () => {
    db(undefined, false, COMPLETE_CANDIDATE, { candidate_languages: 1 });
    await expect(getCandidateProfileSummary()).resolves.toMatchObject({
      completionPct: 100,
      checklist: { basicInfo: true, preferences: true, experience: true, location: true, languages: true, availability: true },
    });
  });

  it('krok 5 liczy się także z samym certyfikatem, jak w kreatorze', async () => {
    db(undefined, false, COMPLETE_CANDIDATE, { candidate_certificates: 1 });
    const result = await getCandidateProfileSummary();
    expect(result.checklist.languages).toBe(true);
    expect(result.completionPct).toBe(100);
  });

  it('liczniki relacji dotyczą wyłącznie profilu kandydata z sesji', async () => {
    db();
    await getCandidateProfileSummary();
    const { text } = fakeDb.callsTo('candidate.profile-completeness')[0]!;
    expect(text).toContain('cp.profile_id = $1');
    expect(text).toContain('l.candidate_profile_id = cp.id');
    expect(text).toContain('c.candidate_profile_id = cp.id');
  });

  it('rozróżnia prawdziwie pusty profil od awarii', async () => {
    db(undefined, true);
    const result = await getCandidateProfileSummary();
    expect(result.loadFailed).toBe(false);
    expect(result.completionPct).toBe(0);
    expect(Object.values(result.checklist)).toEqual([false, false, false, false, false, false]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(PROFILE_QUERIES)('nie pokazuje zera jako wyniku po błędzie %s', async (name) => {
    db(name);
    await expect(getCandidateProfileSummary()).resolves.toMatchObject({ loadFailed: true });
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'candidate.getCandidateProfileSummary' });
  });

  it('awaria profilu nie zeruje pozostałych liczników pulpitu', async () => {
    db('candidate.profile-name');
    await expect(getCandidateOverview()).resolves.toMatchObject({
      newJobsCount: 12,
      activeApplicationsCount: 4,
      unreadMessagesCount: 0,
    });
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'candidate.getCandidateOverview.profileSummary' });
  });
});
