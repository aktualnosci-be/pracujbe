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
    rpc: vi.fn().mockResolvedValue({ data: [{ job_id: jobId, slug: 'older-job', title: 'Older job', company_name: 'Company' }], error: null }),
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
});
