import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError }));

import { getConversationThread } from '@/lib/data/messages';
import * as portal from '@/lib/db/portal';

const ME = '11111111-1111-4111-8111-111111111111';

type Stage = 'auth' | 'conversation' | 'messages' | 'members' | 'profiles' | 'companies' | 'team';

const QUERY: Record<Exclude<Stage, 'auth'>, string> = {
  conversation: 'messages.conversation',
  messages: 'messages.thread-page',
  members: 'messages.thread-other-members',
  profiles: 'messages.profile-names',
  companies: 'messages.company-names',
  team: 'messages.company-members',
};

function setup(failing?: Stage, missing = false) {
  resetFakeDb({ id: ME, role: 'candidate' } as PortalIdentity);
  const failure = pgError('XX000', 'private database detail');
  const rows: Record<Exclude<Stage, 'auth'>, unknown[]> = {
    conversation: missing ? [] : [{ id: 'thread-1', subject: 'Praca', company_id: 'company-1' }],
    messages: [{ id: 'message-1', body: 'Dzień dobry', sender_id: 'other', is_system: false, created_at: '2026-09-23T00:00:00Z' }],
    members: [{ profile_id: 'other' }],
    profiles: [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }],
    companies: [{ id: 'company-1', name: 'Firma' }],
    team: [],
  };
  for (const [stage, name] of Object.entries(QUERY) as Array<[Exclude<Stage, 'auth'>, string]>) {
    fakeDb.rows(name, () => {
      if (failing === stage) throw failure;
      return rows[stage];
    });
  }
  const spy = failing === 'auth' ? vi.spyOn(portal, 'getPortalIdentity').mockRejectedValueOnce(failure) : null;
  return { failure, spy };
}

describe('odczyt wątku rozmowy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('odróżnia prawdziwy brak lub niedostępność RLS od awarii, bez dalszych odczytów', async () => {
    setup(undefined, true);
    expect(await getConversationThread('thread-1')).toEqual({ status: 'not-found' });
    expect(fakeDb.calls.map((call) => call.name)).toEqual(['messages.conversation']);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('nie odpytuje prywatnych tabel bez sesji', async () => {
    setup();
    fakeSession.identity = null;
    expect(await getConversationThread('thread-1')).toEqual({ status: 'not-found' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each<Stage>(['auth', 'conversation', 'messages', 'members', 'profiles', 'companies', 'team'])(
    'zwraca jawny błąd etapu %s bez ujawniania szczegółów', async (stage) => {
      const { failure, spy } = setup(stage);
      expect(await getConversationThread('thread-1')).toEqual({ status: 'error' });
      expect(captureError).toHaveBeenCalledWith(failure, { area: 'messages.getConversationThread' });
      spy?.mockRestore();
    },
  );

  it('zwraca tylko widoczny wątek po udanym odczycie', async () => {
    setup();
    expect(await getConversationThread('thread-1')).toMatchObject({
      status: 'ready',
      thread: { id: 'thread-1', counterpartyName: 'Anna Nowak', messages: [{ body: 'Dzień dobry', mine: false }] },
    });
    expect(fakeDb.callsTo('messages.conversation')[0]).toMatchObject({ values: ['thread-1'], as: ME });
    expect(fakeDb.callsTo('messages.thread-other-members')[0]!.values).toEqual(['thread-1', ME]);
  });
});
