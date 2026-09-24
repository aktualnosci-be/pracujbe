import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCandidateOverview, getCandidateProfileSummary } from '@/lib/data/candidate';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { captureError } from '@/lib/sentry';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const readError = { code: 'read-failed' };

const PARTIAL_CANDIDATE = { id: 'candidate-profile-1', experience_years: 3, occupations: ['Magazynier'], categories: [], city: 'Gent', availability: null };
const COMPLETE_CANDIDATE = { ...PARTIAL_CANDIDATE, categories: ['logistics'], availability: 'immediate' };

function client(failedTable?: string, empty = false, candidate: Record<string, unknown> = PARTIAL_CANDIDATE, counts: Record<string, number> = {}) {
  const profile = { first_name: 'Anna', last_name: 'Kowalska' };
  const single = (table: string) => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: empty ? null : table === 'profiles' ? profile : candidate, error: failedTable === table ? readError : null })),
    };
    return query;
  };
  const count = (table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(async () => ({ count: counts[table] ?? 0, error: failedTable === table ? readError : null })),
    };
    return query;
  };
  const supabase = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'owner-1' } } })) },
    from: vi.fn((table: string) => {
      if (table === 'profiles' || table === 'candidate_profiles') return single(table);
      if (table === 'conversation_members') {
        const query = { select: vi.fn(() => query), eq: vi.fn(async () => ({ data: [], error: null })) };
        return query;
      }
      if (table === 'applications') {
        const query = {
          select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query),
          in: vi.fn(async () => ({ count: 4, error: null })),
        };
        return query;
      }
      return count(table);
    }),
    rpc: vi.fn(async () => ({ data: 12, error: null })),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('podsumowanie profilu kandydata', () => {
  it('liczy ukończenie z rzeczywiście odczytanych pól i relacji', async () => {
    client();
    await expect(getCandidateProfileSummary()).resolves.toMatchObject({
      loadFailed: false, firstName: 'Anna', completionPct: 50,
      checklist: { basicInfo: true, preferences: false, experience: true, location: true, languages: false, availability: false },
    });
  });

  it('profil z uzupełnionymi wszystkimi krokami kreatora ma 100% (#315)', async () => {
    client(undefined, false, COMPLETE_CANDIDATE, { candidate_languages: 1 });
    await expect(getCandidateProfileSummary()).resolves.toMatchObject({
      completionPct: 100,
      checklist: { basicInfo: true, preferences: true, experience: true, location: true, languages: true, availability: true },
    });
  });

  it('krok 5 liczy się także z samym certyfikatem, jak w kreatorze', async () => {
    client(undefined, false, COMPLETE_CANDIDATE, { candidate_certificates: 1 });
    const result = await getCandidateProfileSummary();
    expect(result.checklist.languages).toBe(true);
    expect(result.completionPct).toBe(100);
  });

  it('rozróżnia prawdziwie pusty profil od awarii', async () => {
    const supabase = client(undefined, true);
    const result = await getCandidateProfileSummary();
    expect(result.loadFailed).toBe(false);
    expect(result.completionPct).toBe(0);
    expect(Object.values(result.checklist)).toEqual([false, false, false, false, false, false]);
    expect(supabase.from).not.toHaveBeenCalledWith('candidate_languages');
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(['profiles', 'candidate_profiles', 'candidate_languages', 'candidate_certificates'])(
    'nie pokazuje zera jako wyniku po błędzie %s', async (table) => {
      client(table);
      await expect(getCandidateProfileSummary()).resolves.toMatchObject({ loadFailed: true });
      expect(captureError).toHaveBeenCalledWith(readError, { area: 'candidate.getCandidateProfileSummary' });
    },
  );

  it('awaria profilu nie zeruje pozostałych liczników pulpitu', async () => {
    client('profiles');
    await expect(getCandidateOverview()).resolves.toMatchObject({
      newJobsCount: 12,
      activeApplicationsCount: 4,
      unreadMessagesCount: 0,
    });
  });
});
