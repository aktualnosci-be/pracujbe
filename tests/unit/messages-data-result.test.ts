import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError }));

import { getConversationsResult } from '@/lib/data/messages';
import * as portal from '@/lib/db/portal';

const ME = '11111111-1111-4111-8111-111111111111';

describe('wynik wczytania listy rozmów', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb({ id: ME, role: 'candidate' } as PortalIdentity);
  });

  it('odróżnia awarię sesji od poprawnego braku sesji', async () => {
    const authError = new Error('Auth unavailable');
    const spy = vi.spyOn(portal, 'getPortalIdentity').mockRejectedValueOnce(authError);

    expect(await getConversationsResult()).toEqual({ status: 'error', items: [] });
    expect(fakeDb.calls).toHaveLength(0);
    expect(captureError).toHaveBeenCalledWith(authError, { area: 'messages.getConversations' });
    spy.mockRestore();

    fakeSession.identity = null;
    expect(await getConversationsResult()).toEqual({ status: 'ready', items: [] });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('odróżnia błąd zapytania od poprawnej pustej listy członkostw', async () => {
    const queryError = pgError('08006', 'DB unavailable');
    fakeDb.rows('messages.my-memberships', () => { throw queryError; });

    expect(await getConversationsResult()).toEqual({ status: 'error', items: [] });
    expect(captureError).toHaveBeenCalledWith(queryError, { area: 'messages.getConversations' });

    fakeDb.rows('messages.my-memberships', []);
    expect(await getConversationsResult()).toEqual({ status: 'ready', items: [] });
    // Członkostwa zawężone do konta z sesji.
    expect(fakeDb.callsTo('messages.my-memberships').at(-1)).toMatchObject({ values: [ME], as: ME });
  });

  it('składa listę: druga strona pod RLS, podsumowanie z RPC (w tym nazwa firmy, #25/0166)', async () => {
    fakeDb
      .rows('messages.my-memberships', [{ conversation_id: 'c1', last_read_at: null }, { conversation_id: 'c2', last_read_at: null }])
      .rows('messages.conversations', [
        { id: 'c2', subject: 'Kierowca', company_id: 'co-1', last_message_at: '2026-09-23T10:00:00Z' },
        { id: 'c1', subject: 'Magazynier', company_id: 'co-1', last_message_at: '2026-09-22T10:00:00Z' },
      ])
      .rows('messages.other-members', [{ conversation_id: 'c1', profile_id: 'p-anna' }, { conversation_id: 'c2', profile_id: 'p-hidden' }])
      .rows('messages.profile-names', [{ id: 'p-anna', first_name: 'Anna', last_name: 'Nowak' }])
      .rpc('get_conversation_summaries', [
        { conversation_id: 'c2', company_name: 'Firma', last_body: 'Dzień dobry', last_at: '2026-09-23T10:00:00.123456+00:00', unread_count: 2 },
      ]);

    const result = await getConversationsResult();
    expect(result).toEqual({
      status: 'ready',
      items: [
        { id: 'c2', subject: 'Kierowca', counterpartyName: 'Firma', lastPreview: 'Dzień dobry',
          lastMessageAt: '2026-09-23T10:00:00.123456+00:00', unread: true, unreadCount: 2 },
        { id: 'c1', subject: 'Magazynier', counterpartyName: 'Anna Nowak', lastPreview: '',
          lastMessageAt: '2026-09-22T10:00:00Z', unread: false, unreadCount: 0 },
      ],
    });
    expect(fakeDb.callsTo('messages.other-members')[0]!.values).toEqual([['c2', 'c1'], ME]);
    expect(fakeDb.calls.every((call) => call.as === ME)).toBe(true);
  });

  it('awaria RPC podsumowań = jawny błąd listy', async () => {
    fakeDb
      .rows('messages.my-memberships', [{ conversation_id: 'c1' }])
      .rows('messages.conversations', [{ id: 'c1', subject: 'x', company_id: null }])
      .rows('messages.other-members', [])
      .rpc('get_conversation_summaries', () => { throw pgError('42501', 'permission denied for function'); });
    expect(await getConversationsResult()).toEqual({ status: 'error', items: [] });
  });

  it('tryb demo bez bazy', async () => {
    fakeSession.configured = false;
    const result = await getConversationsResult('pl');
    expect(result.status).toBe('ready');
    expect(result.items.length).toBeGreaterThan(0);
    expect(fakeDb.calls).toHaveLength(0);
  });
});
