import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicSavedJobs } from '@/lib/actions/public-saved-jobs';
import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
function client({
  user = { id: userId } as { id: string } | null,
  role = 'candidate',
  readError = false,
  authError = null as { name: string } | null,
} = {}) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi
      .fn()
      .mockResolvedValue({
        data: readError ? null : [{ job_id: id }],
        error: readError ? {} : null,
      }),
    single: vi.fn().mockResolvedValue({ data: { role }, error: null }),
  };
  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }),
    },
    from: vi.fn().mockReturnValue(query),
  };
  vi.mocked(createServerClient).mockResolvedValue(mock as never);
  return { mock, query };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});
describe('Public saved jobs batch action', () => {
  it('reads one bounded deduplicated collection under authenticated ownership', async () => {
    const { mock, query } = client();
    expect(await getPublicSavedJobs([id, id])).toEqual({
      status: 'candidate',
      savedIds: [id],
    });
    expect(
      mock.from.mock.calls.filter(([table]) => table === 'saved_jobs'),
    ).toHaveLength(1);
    expect(query.eq).toHaveBeenCalledWith('candidate_id', userId);
    expect(query.in).toHaveBeenCalledWith('job_id', [id]);
    expect(query.limit).toHaveBeenCalledWith(100);
  });
  it('does not read saved rows for anonymous or employer accounts', async () => {
    let result = client({ user: null });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'anonymous' });
    expect(result.mock.from).not.toHaveBeenCalled();
    result = client({ role: 'employer' });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'unavailable' });
    expect(result.mock.from).not.toHaveBeenCalledWith('saved_jobs');
  });
  it('separates failed reads from an empty collection', async () => {
    client({ readError: true });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'error' });
  });
  it('fails closed on auth failure, including an accompanying user', async () => {
    client({ authError: { name: 'AuthRetryableFetchError' } });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'error' });
  });
  it('rejects invalid and oversized input before connecting', async () => {
    expect(await getPublicSavedJobs(['invalid'])).toEqual({
      status: 'unavailable',
    });
    expect(await getPublicSavedJobs(Array(101).fill(id))).toEqual({
      status: 'unavailable',
    });
    expect(createServerClient).not.toHaveBeenCalled();
  });
  it('does not simulate saving when the service is unconfigured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'unavailable' });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
