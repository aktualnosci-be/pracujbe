import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClient, captureError } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient }));
vi.mock('@/lib/sentry', () => ({ captureError }));

import { getConversationsResult } from '@/lib/data/messages';

describe('wynik wczytania listy rozmów', () => {
  beforeEach(() => vi.clearAllMocks());

  it('odróżnia awarię Auth od poprawnego braku sesji', async () => {
    const from = vi.fn();
    const authError = new Error('Auth unavailable');
    createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: authError }) },
      from,
    });

    expect(await getConversationsResult()).toEqual({ status: 'error', items: [] });
    expect(from).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledWith(authError, { area: 'messages.getConversations' });

    createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from,
    });

    expect(await getConversationsResult()).toEqual({ status: 'ready', items: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it('odróżnia błąd zapytania od poprawnej pustej listy członkostw', async () => {
    const query = vi.fn();
    const from = vi.fn().mockReturnValue({ select: () => ({ eq: query }) });
    createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me' } }, error: null }) },
      from,
    });
    const queryError = new Error('DB unavailable');
    query.mockResolvedValue({ data: null, error: queryError });

    expect(await getConversationsResult()).toEqual({ status: 'error', items: [] });
    expect(captureError).toHaveBeenCalledWith(queryError, { area: 'messages.getConversations' });

    query.mockResolvedValue({ data: [], error: null });
    expect(await getConversationsResult()).toEqual({ status: 'ready', items: [] });
  });
});
