import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClient, captureError } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient }));
vi.mock('@/lib/sentry', () => ({ captureError }));

import { getConversationThread } from '@/lib/data/messages';

type Stage = 'auth' | 'conversations' | 'messages' | 'conversation_members' | 'profiles' | 'companies';

function client(failing?: Stage, missing = false) {
  const failure = new Error('private database detail');
  const rows: Record<Exclude<Stage, 'auth'>, unknown> = {
    conversations: missing ? null : { id: 'thread-1', subject: 'Praca', company_id: 'company-1' },
    messages: [{ id: 'message-1', body: 'Dzień dobry', sender_id: 'other', is_system: false, created_at: '2026-09-23T00:00:00Z' }],
    conversation_members: [{ profile_id: 'other' }],
    profiles: [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }],
    companies: [{ id: 'company-1', name: 'Firma' }],
  };
  const from = vi.fn((table: Exclude<Stage, 'auth'>) => {
    const response = { data: rows[table], error: failing === table ? failure : null };
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      order: () => query,
      limit: () => Promise.resolve(response),
      neq: () => Promise.resolve(response),
      in: () => Promise.resolve(response),
      maybeSingle: () => Promise.resolve(response),
    };
    return query;
  });
  createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({
      data: { user: failing === 'auth' ? null : { id: 'me' } },
      error: failing === 'auth' ? failure : null,
    }) },
    from,
  });
  return { from, failure };
}

describe('odczyt wątku rozmowy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('odróżnia prawdziwy brak lub niedostępność RLS od awarii, bez dalszych odczytów', async () => {
    const { from } = client(undefined, true);
    expect(await getConversationThread('thread-1')).toEqual({ status: 'not-found' });
    expect(from).toHaveBeenCalledTimes(1);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('nie odpytuje prywatnych tabel bez sesji', async () => {
    const from = vi.fn();
    createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from,
    });
    expect(await getConversationThread('thread-1')).toEqual({ status: 'not-found' });
    expect(from).not.toHaveBeenCalled();
  });

  it.each<Stage>(['auth', 'conversations', 'messages', 'conversation_members', 'profiles', 'companies'])(
    'zwraca jawny błąd etapu %s bez ujawniania szczegółów', async (stage) => {
      const { failure } = client(stage);
      expect(await getConversationThread('thread-1')).toEqual({ status: 'error' });
      expect(captureError).toHaveBeenCalledWith(failure, { area: 'messages.getConversationThread' });
    },
  );

  it('zwraca tylko widoczny wątek po udanym odczycie', async () => {
    client();
    expect(await getConversationThread('thread-1')).toMatchObject({
      status: 'ready',
      thread: { id: 'thread-1', counterpartyName: 'Anna Nowak', messages: [{ body: 'Dzień dobry', mine: false }] },
    });
  });
});
