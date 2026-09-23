import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSavedJobs } from '@/lib/data/candidate';
import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const userId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';

function client({ rows = [], readError = null, rpcError = null }: {
  rows?: { job_id: string; created_at: string }[];
  readError?: object | null;
  rpcError?: object | null;
} = {}) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: readError }),
  };
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn().mockResolvedValue({
      data: [{ id: jobId, slug: 'praca', title: 'Praca', company_name: 'Firma', city: 'Gent' }],
      error: rpcError,
    }),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('saved jobs read', () => {
  it('reports genuine empty without public lookup', async () => {
    const { supabase, query } = client();
    expect(await getSavedJobs('pl')).toEqual({ status: 'ready', jobs: [] });
    expect(query.eq).toHaveBeenCalledWith('candidate_id', userId);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps private read and public lookup failures distinct from empty', async () => {
    client({ readError: { message: 'read failed' } });
    expect(await getSavedJobs('pl')).toEqual({ status: 'error' });
    client({ rows: [{ job_id: jobId, created_at: '2026-09-23' }], rpcError: { message: 'lookup failed' } });
    expect(await getSavedJobs('pl')).toEqual({ status: 'error' });
  });

  it('only presents saved rows with a public active job', async () => {
    const { supabase } = client({ rows: [{ job_id: jobId, created_at: '2026-09-23' }] });
    expect(await getSavedJobs('nl')).toMatchObject({
      status: 'ready', jobs: [{ id: jobId, title: 'Praca', saved: true }],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_jobs', expect.objectContaining({ p_locale: 'nl' }));
  });
});
