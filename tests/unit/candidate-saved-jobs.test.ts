import { readFileSync } from 'node:fs';
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
const oldSavedJob = { id: jobId, slug: 'stara-praca', title: 'Starsza oferta', company_name: 'Firma', city: 'Gent' };

function client({ rows = [], readError = null, user = { id: userId } }: {
  rows?: typeof oldSavedJob[];
  readError?: object | null;
  user?: { id: string } | null;
} = {}) {
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: rows, error: readError }),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('saved jobs read', () => {
  it('reports a genuine empty collection', async () => {
    const supabase = client();
    expect(await getSavedJobs('pl')).toEqual({ status: 'ready', jobs: [] });
    expect(supabase.rpc).toHaveBeenCalledWith('get_saved_jobs_display', { p_locale: 'pl' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('keeps failed reads and missing auth distinct from empty', async () => {
    client({ readError: { message: 'read failed' } });
    expect(await getSavedJobs('pl')).toEqual({ status: 'error' });
    const anonymous = client({ user: null });
    expect(await getSavedJobs('pl')).toEqual({ status: 'error' });
    expect(anonymous.rpc).not.toHaveBeenCalled();
  });

  it('shows an older saved job beyond the first 100 public offers', async () => {
    const supabase = client({ rows: [oldSavedJob] });
    expect(await getSavedJobs('nl')).toEqual({
      status: 'ready',
      jobs: [{ id: jobId, slug: 'stara-praca', title: 'Starsza oferta', companyName: 'Firma', city: 'Gent', match: null, saved: true }],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_saved_jobs_display', { p_locale: 'nl' });
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_public_jobs', expect.anything());
  });

  it('RPC joins saved rows before sorting and restricts results to the owner and public jobs', () => {
    const sql = readFileSync('supabase/migrations/0066_saved_jobs_display.sql', 'utf8');
    expect(sql).toMatch(/from public\.saved_jobs s\s+join public\.jobs j on j\.id = s\.job_id/i);
    expect(sql).toMatch(/s\.candidate_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/j\.status = 'active'/i);
    expect(sql).toMatch(/c\.status = 'verified'/i);
    expect(sql).not.toMatch(/\blimit\s+(?:100|least)\b/i);
    expect(sql).toMatch(/grant execute on function public\.get_saved_jobs_display\(text\) to authenticated/i);
  });
});
