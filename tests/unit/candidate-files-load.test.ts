import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCandidateFiles } from '@/lib/data/candidate-files';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getSignedFileUrl } from '@/lib/storage';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getSignedFileUrl: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

function client(result: { data?: unknown; error?: unknown; user?: { id: string } | null }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: result.data ?? [], error: result.error ?? null }),
  };
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: result.user === undefined ? { id: 'self' } : result.user },
      }),
    },
    from: vi.fn(() => query),
  };
  return { supabase, query };
}

function useClient(result: Parameters<typeof client>[0]) {
  const c = client(result);
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(createServerClient).mockResolvedValue(
    c.supabase as unknown as Awaited<ReturnType<typeof createServerClient>>,
  );
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe('loadCandidateFiles (#331)', () => {
  it('błąd zapytania to stan błędu, a nie pusta lista', async () => {
    useClient({ error: { message: 'boom' } });
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'error' });
  });

  it('brak sesji to stan błędu', async () => {
    useClient({ user: null });
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'error' });
  });

  it('udany pusty odczyt to gotowa pusta lista', async () => {
    useClient({ data: [] });
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'ready', items: [] });
  });

  it('czyta tylko własne CV i przy błędzie jednego URL-a zostawia pozycję bez linku', async () => {
    const { query } = useClient({
      data: [
        { id: 'a', path: 'self/a.pdf', bucket: 'cv', file_name: 'a.pdf' },
        { id: 'b', path: 'self/b.pdf', bucket: 'cv', file_name: 'b.pdf' },
      ],
    });
    vi.mocked(getSignedFileUrl)
      .mockResolvedValueOnce('https://signed/a')
      .mockRejectedValueOnce(new Error('sign failed'));

    await expect(loadCandidateFiles()).resolves.toEqual({
      status: 'ready',
      items: [
        { id: 'a', fileName: 'a.pdf', url: 'https://signed/a' },
        { id: 'b', fileName: 'b.pdf', url: null },
      ],
    });
    expect(query.eq).toHaveBeenCalledWith('owner_id', 'self');
    expect(query.eq).toHaveBeenCalledWith('entity_type', 'candidate_cv');
  });

  it('bez bazy zwraca gotową pustą listę (tryb demo)', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'ready', items: [] });
  });
});
