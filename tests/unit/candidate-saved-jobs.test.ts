import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSavedJobs } from '@/lib/data/candidate';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const userId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';
const oldSavedJob: Record<string, unknown> = { id: jobId, slug: 'stara-praca', title: 'Starsza oferta', company_name: 'Firma', city: 'Gent', job_availability: 'available' };

function db({ rows = [], readError = false, user = true }: {
  rows?: Record<string, unknown>[];
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
      jobs: [{ id: jobId, slug: 'stara-praca', title: 'Starsza oferta', companyName: 'Firma', city: 'Gent', availability: 'available' }],
    });
    expect(fakeDb.callsTo('get_saved_jobs_display')[0]!.args).toEqual({ p_locale: 'nl' });
    expect(fakeDb.callsTo('get_public_jobs')).toHaveLength(0);
  });

  it('keeps saved jobs that lost their public page, without a link (0162)', async () => {
    const closedId = '11111111-1111-4111-8111-111111111112';
    db({ rows: [
      oldSavedJob,
      // Nawet gdyby RPC oddało slug, oferta niepubliczna nie dostaje linku.
      { id: closedId, slug: 'zamknieta', title: 'Zamknięta', company_name: 'Firma', city: 'Gent', job_availability: 'closed' },
    ] });
    const result = await getSavedJobs('pl');
    expect(result.status === 'ready' && result.jobs.map((j) => [j.id, j.slug, j.availability])).toEqual([
      [jobId, 'stara-praca', 'available'],
      [closedId, null, 'closed'],
    ]);
  });

  it('RPC 0162 returns every own saved row with availability and slug only for public jobs', () => {
    const sql = readFileSync('supabase/migrations/0162_saved_jobs_availability.sql', 'utf8');
    expect(sql).toMatch(/from public\.saved_jobs s\s+join public\.jobs j on j\.id = s\.job_id/i);
    expect(sql).toMatch(/where s\.candidate_id = auth\.uid\(\)\s+order by/i);
    expect(sql).toMatch(/case when v\.availability = 'available' then j\.slug end as slug/i);
    // Kontrola ujemna: filtr ofert publicznych z 0066 w WHERE ukrywałby zapisy niedostępnych ofert.
    const where = sql.slice(sql.search(/where s\.candidate_id/i));
    expect(where).not.toMatch(/j\.status = 'active'/i);
    expect(sql).not.toMatch(/\blimit\s+(?:100|least)\b/i);
    expect(sql).toMatch(/revoke all on function public\.get_saved_jobs_display\(text\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.get_saved_jobs_display\(text\) to authenticated/i);
  });

  /** Ostatnia (wg numeru) migracja definiująca daną funkcję — definicja obowiązująca. */
  function latestDefinition(pattern: RegExp): { file: string; sql: string } {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
    const hits = files.filter((f) => pattern.test(readFileSync(`supabase/migrations/${f}`, 'utf8')));
    const file = hits[hits.length - 1]!;
    return { file, sql: readFileSync(`supabase/migrations/${file}`, 'utf8') };
  }

  it('#882: current get_saved_jobs_display gates metadata of non-public jobs by saved_while_public', () => {
    const { file, sql } = latestDefinition(/function public\.get_saved_jobs_display\(/i);
    expect(file).not.toBe('0162_saved_jobs_availability.sql');
    const body = sql.slice(sql.search(/function public\.get_saved_jobs_display\(/i));
    expect(body).toMatch(/v\.availability = 'available' or s\.saved_while_public/i);
    for (const column of ['title', 'company_name', 'city']) {
      expect(body).toMatch(new RegExp(`case when m\\.visible then [^\\n]+ else '' end as ${column}`, 'i'));
    }
    // Kontrola ujemna: definicja z 0162 zwraca metadane bez bramki dowodu.
    const old = readFileSync('supabase/migrations/0162_saved_jobs_availability.sql', 'utf8');
    expect(old).not.toMatch(/saved_while_public/);
  });

  it('#882: every new saved_jobs row goes through the public-target guard with row locks', () => {
    const { sql } = latestDefinition(/function public\.saved_jobs_guard_target\(/i);
    expect(sql).toMatch(/before insert on public\.saved_jobs/i);
    expect(sql).toMatch(/for share of j, c/i);
    expect(sql).toMatch(/raise exception 'NOT_FOUND/i);
    // Kontrola ujemna: sama polityka RLS z 0009 nie sprawdza celu zapisu.
    const rls = readFileSync('supabase/migrations/0009_rls.sql', 'utf8');
    const policy = rls.slice(rls.indexOf('saved_jobs_insert_own'), rls.indexOf('saved_jobs_insert_own') + 200);
    expect(policy).not.toMatch(/public\.jobs|job_is_public/);
  });
});
