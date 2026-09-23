import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyOffersPage } from '@/lib/data/candidate';
import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const ownerId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';
const createdAt = '2026-09-20T09:00:00+00:00';
/** 21 propozycji o RÓWNYM created_at — kolejność rozstrzyga wyłącznie UUID. */
const records = Array.from({ length: 21 }, (_, index) => ({
  id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(21 - index).padStart(12, '0')}`,
  job_id: jobId,
  status: index === 20 ? 'accepted' : 'sent',
  message: `Propozycja ${21 - index}`,
  sent_at: createdAt,
  created_at: createdAt,
  expires_at: null,
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
    beforeDate = /created_at\.lt\."([^"]+)"/.exec(filter)?.[1] ?? null;
    beforeId = /id\.lt\.([0-9a-f-]+)/.exec(filter)?.[1] ?? null;
    return query;
  });
  query.limit.mockImplementation(async (limit: number) => ({
    data: (options.rows ?? records).filter((row) =>
      !beforeDate || row.created_at < beforeDate || (row.created_at === beforeDate && row.id < beforeId!),
    ).slice(0, limit),
    error: options.fail ? { message: 'database unavailable' } : null,
  }));
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.userId === null ? null : { id: options.userId ?? ownerId } } }) },
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn().mockResolvedValue({ data: [{ job_id: jobId, id: jobId, slug: 'older-job', title: 'Older job', company_name: 'Company' }], error: null }),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('historia propozycji kandydata (#245)', () => {
  it('udostępnia wszystkie 21 własnych propozycji bez powtórzeń przy równym czasie', async () => {
    const { query } = client();
    const pages = [await getMyOffersPage('pl')];
    while (pages[pages.length - 1]!.nextCursor) {
      pages.push(await getMyOffersPage('pl', pages[pages.length - 1]!.nextCursor));
      expect(pages.length).toBeLessThan(10);
    }
    const all = pages.flatMap((page) => page.items);
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 1]);
    expect(all).toHaveLength(21);
    expect(new Set(all.map((item) => item.id)).size).toBe(21);
    // Najstarsza propozycja (po zmianie statusu) jest osiągalna, z poprawnym statusem i treścią.
    expect(all[20]).toMatchObject({ id: records[20]!.id, status: 'accepted', message: 'Propozycja 1', jobTitle: 'Older job' });
    expect(query.eq).toHaveBeenCalledWith('candidate_id', ownerId);
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(query.or).toHaveBeenCalledWith(`created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${records[9]!.id})`);
    expect(query.limit).toHaveBeenCalledWith(11);
  });

  it('stosuje datę przed UUID, gdy starsze propozycje mają większe identyfikatory', async () => {
    const mixed = [
      ...records.slice(0, 8).map((row, index) => ({ ...row, id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(8 - index).padStart(12, '0')}` })),
      ...records.slice(8).map((row, index) => ({
        ...row,
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(21 - index).padStart(12, '0')}`,
        created_at: '2026-09-19T09:00:00+00:00',
      })),
    ];
    client({ rows: mixed });
    const first = await getMyOffersPage('pl');
    const second = await getMyOffersPage('pl', first.nextCursor);
    const third = await getMyOffersPage('pl', second.nextCursor);
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect(third.nextCursor).toBeNull();
  });

  it('nie odpytuje propozycji bez sesji', async () => {
    const { supabase } = client({ userId: null });
    expect(await getMyOffersPage('pl')).toEqual({ items: [], nextCursor: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('nie udaje pustej strony po błędzie odczytu', async () => {
    client({ fail: true });
    await expect(getMyOffersPage('pl')).rejects.toEqual({ message: 'database unavailable' });
  });
});
