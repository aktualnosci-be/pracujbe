import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSavedJobs } from '@/lib/data/candidate';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const userId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';
const oldSavedJob = { id: jobId, slug: 'stara-praca', title: 'Starsza oferta', company_name: 'Firma', city: 'Gent' };

function db({ rows = [], readError = false, user = true }: {
  rows?: typeof oldSavedJob[];
  readError?: boolean;
  user?: boolean;
} = {}) {
  resetFakeDb(user ? { id: userId, role: 'candidate' } : null);
  fakeDb.rpc('get_saved_jobs_display', () => {
    if (readError) throw pgError('XX000', 'read failed');
    return rows;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saved jobs read', () => {
  it('reports a genuine empty collection', async () => {
    db();
    expect(await getSavedJobs('pl')).toEqual({ status: 'ready', jobs: [] });
    expect(fakeDb.calls).toHaveLength(1);
    expect(fakeDb.callsTo('get_saved_jobs_display')[0]).toMatchObject({ as: userId, args: { p_locale: 'pl' } });
  });

  it('keeps failed reads and missing auth distinct from empty', async () => {
    db({ readError: true });
    expect(await getSavedJobs('pl')).toEqual({ status: 'error' });
    db({ user: false });
    expect(await getSavedJobs('pl')).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('shows an older saved job beyond the first 100 public offers', async () => {
    db({ rows: [oldSavedJob] });
    expect(await getSavedJobs('nl')).toEqual({
      status: 'ready',
      jobs: [{ id: jobId, slug: 'stara-praca', title: 'Starsza oferta', companyName: 'Firma', city: 'Gent', match: null, saved: true }],
    });
    expect(fakeDb.callsTo('get_saved_jobs_display')[0]!.args).toEqual({ p_locale: 'nl' });
    expect(fakeDb.callsTo('get_public_jobs')).toHaveLength(0);
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
