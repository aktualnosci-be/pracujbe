import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyApplicationsPage } from '@/lib/data/candidate';
import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const ownerId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';
const submittedAt = '2026-09-20T09:00:00+00:00';
const records = Array.from({ length: 15 }, (_, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(15 - index).padStart(12, '0')}`,
  job_id: jobId,
  status: 'submitted',
  submitted_at: submittedAt,
}));

type AppliedJobRow = { job_id: string; slug: string; title: string; company_name: string };

/**
 * Atrapa `rpc('get_applied_jobs_display')`: bez filtra zwraca całą historię, z `.in('job_id')`
 * tylko wskazane oferty. `transferred` liczy wiersze, które faktycznie opuściły „bazę”.
 */
function appliedJobsBuilder(history: AppliedJobRow[], stats = { transferred: 0 }) {
  const respond = (rows: AppliedJobRow[]) => {
    stats.transferred += rows.length;
    return { data: rows, error: null };
  };
  return {
    in: vi.fn(async (column: string, ids: string[]) => {
      expect(column).toBe('job_id');
      return respond(history.filter((row) => ids.includes(row.job_id)));
    }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(respond(history)).then(resolve, reject),
  };
}

function client(options: { fail?: boolean; userId?: string | null; rows?: typeof records } = {}) {
  let beforeId: string | null = null;
  let beforeDate: string | null = null;
  const query = {
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), or: vi.fn(), limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.or.mockImplementation((filter: string) => {
    beforeDate = /submitted_at\.lt\."([^"]+)"/.exec(filter)?.[1] ?? null;
    beforeId = /id\.lt\.([0-9a-f-]+)/.exec(filter)?.[1] ?? null;
    return query;
  });
  query.limit.mockImplementation(async (limit: number) => ({
    data: (options.rows ?? records).filter((row) =>
      !beforeDate || row.submitted_at < beforeDate || (row.submitted_at === beforeDate && row.id < beforeId!),
    ).slice(0, limit),
    error: options.fail ? { message: 'database unavailable' } : null,
  }));
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.userId === null ? null : { id: options.userId ?? ownerId } } }) },
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn(() => appliedJobsBuilder([{ job_id: jobId, slug: 'older-job', title: 'Older job', company_name: 'Company' }])),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('candidate application history', () => {
  it('reaches all 15 own applications through a tie-safe cursor without repeats', async () => {
    const { query, supabase } = client();
    const first = await getMyApplicationsPage('pl');
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toEqual({ submittedAt, id: records[9]!.id });
    const second = await getMyApplicationsPage('pl', first.nextCursor);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(15);
    expect(query.eq).toHaveBeenCalledWith('candidate_id', ownerId);
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.order).toHaveBeenCalledWith('submitted_at', { ascending: false });
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(query.or).toHaveBeenCalledWith(`submitted_at.lt."${submittedAt}",and(submitted_at.eq."${submittedAt}",id.lt.${records[9]!.id})`);
    expect(query.limit).toHaveBeenCalledWith(11);
    expect(supabase.rpc).toHaveBeenCalledWith('get_applied_jobs_display', { p_locale: 'pl' });
    expect(second.items.every((row) => row.jobTitle === 'Older job' && row.slug === 'older-job')).toBe(true);
  });

  it('does not query applications without a session', async () => {
    const { supabase } = client({ userId: null });
    expect(await getMyApplicationsPage('pl')).toEqual({ items: [], nextCursor: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('uses date before ID when older applications have larger UUIDs', async () => {
    const mixed = [
      ...records.slice(0, 8).map((row, index) => ({ ...row, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(8 - index).padStart(12, '0')}` })),
      ...records.slice(8).map((row, index) => ({
        ...row,
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(15 - index).padStart(12, '0')}`,
        submitted_at: '2026-09-19T09:00:00+00:00',
      })),
    ];
    client({ rows: mixed });
    const first = await getMyApplicationsPage('pl');
    const second = await getMyApplicationsPage('pl', first.nextCursor);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(15);
    expect(second.items.every((row) => row.date === '2026-09-19T09:00:00+00:00')).toBe(true);
  });

  it('does not disguise a failed page read as an empty page', async () => {
    client({ fail: true });
    await expect(getMyApplicationsPage('pl')).rejects.toEqual({ message: 'database unavailable' });
  });

  // #180: granica strony — 10 zgłoszeń to koniec listy, jedenaste musi dać kursor, nie zniknąć.
  it('treats exactly 10 applications as the end of the list', async () => {
    const { query } = client({ rows: records.slice(0, 10) });
    const page = await getMyApplicationsPage('pl');
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
    expect(query.or).not.toHaveBeenCalled();
  });

  it('keeps the 11th application reachable on the next page', async () => {
    client({ rows: records.slice(0, 11) });
    const first = await getMyApplicationsPage('pl');
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toEqual({ submittedAt, id: records[9]!.id });
    const second = await getMyApplicationsPage('pl', first.nextCursor);
    expect(second.items.map((row) => row.id)).toEqual([records[10]!.id]);
    expect(second.nextCursor).toBeNull();
  });

  // #184: metadane ofert tylko dla rekordów bieżącej strony, nie całej historii.
  describe('job metadata scoped to the current page', () => {
    const jobIdAt = (index: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`;
    const longHistory = Array.from({ length: 120 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(120 - index).padStart(12, '0')}`,
      job_id: jobIdAt(index),
      status: 'submitted',
      submitted_at: submittedAt,
    }));
    const history: AppliedJobRow[] = longHistory.map((row, index) => ({
      job_id: row.job_id, slug: `job-${index}`, title: `Job ${index}`, company_name: `Company ${index}`,
    }));

    function scopedClient() {
      const stats = { transferred: 0 };
      const builders: ReturnType<typeof appliedJobsBuilder>[] = [];
      const { supabase } = client({ rows: longHistory });
      supabase.rpc.mockImplementation(() => {
        const builder = appliedJobsBuilder(history, stats);
        builders.push(builder);
        return builder;
      });
      return { supabase, stats, builders };
    }

    it('asks only for the job IDs of the page, also on the next page of 120+ applications', async () => {
      const { stats, builders } = scopedClient();
      const first = await getMyApplicationsPage('pl');
      expect(builders[0]!.in).toHaveBeenCalledWith('job_id', longHistory.slice(0, 10).map((row) => row.job_id));
      expect(first.items.map((row) => row.jobTitle)).toEqual(history.slice(0, 10).map((row) => row.title));

      const second = await getMyApplicationsPage('pl', first.nextCursor);
      expect(builders).toHaveLength(2);
      expect(builders[1]!.in).toHaveBeenCalledWith('job_id', longHistory.slice(10, 20).map((row) => row.job_id));
      expect(second.items.map((row) => row.slug)).toEqual(history.slice(10, 20).map((row) => row.slug));
      // Dwie strony = 20 wierszy metadanych, nie 2 × 120.
      expect(stats.transferred).toBe(20);
    });

    it('sends each job ID once when several applications on a page share an offer', async () => {
      const shared = longHistory.slice(0, 10).map((row) => ({ ...row, job_id: jobIdAt(0) }));
      const { supabase } = client({ rows: shared });
      const builder = appliedJobsBuilder(history);
      supabase.rpc.mockReturnValue(builder);
      const page = await getMyApplicationsPage('pl');
      expect(builder.in).toHaveBeenCalledWith('job_id', [jobIdAt(0)]);
      expect(page.items.every((row) => row.jobTitle === 'Job 0')).toBe(true);
    });

    it('skips the metadata read for an empty page', async () => {
      const { supabase } = client({ rows: [] });
      expect(await getMyApplicationsPage('pl')).toEqual({ items: [], nextCursor: null });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('propagates a failed metadata read instead of rendering nameless cards', async () => {
      const { supabase } = client({ rows: longHistory });
      supabase.rpc.mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: null, error: { message: 'metadata unavailable' } }),
      } as never);
      await expect(getMyApplicationsPage('pl')).rejects.toEqual({ message: 'metadata unavailable' });
    });

    // Kontrola ujemna: ten sam licznik wychwytuje odczyt bez ograniczenia do strony.
    it('negative control: an unscoped read transfers the whole history and fails the page bound', async () => {
      const stats = { transferred: 0 };
      await appliedJobsBuilder(history, stats);
      expect(stats.transferred).toBe(120);
      expect(stats.transferred).toBeGreaterThan(10);
    });
  });
});
