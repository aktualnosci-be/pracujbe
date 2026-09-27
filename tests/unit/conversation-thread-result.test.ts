import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError }));

import { getConversationThread } from '@/lib/data/messages';
import * as portal from '@/lib/db/portal';

const ME = '11111111-1111-4111-8111-111111111111';

type Stage =
  | 'auth'
  | 'conversation'
  | 'messages'
  | 'members'
  | 'profiles'
  | 'companyName'
  | 'team'
  | 'companyBlock';

const ROW_QUERY: Record<Exclude<Stage, 'auth' | 'companyName'>, string> = {
  conversation: 'messages.conversation',
  messages: 'messages.thread-page',
  members: 'messages.thread-other-members',
  profiles: 'messages.profile-names',
  team: 'messages.company-members',
  companyBlock: 'messages.company-block',
};

function setup(failing?: Stage, missing = false) {
  resetFakeDb({ id: ME, role: 'candidate' } as PortalIdentity);
  const failure = pgError('XX000', 'private database detail');
  const rows: Record<Exclude<Stage, 'auth' | 'companyName'>, unknown[]> = {
    conversation: missing ? [] : [{ id: 'thread-1', subject: 'Praca', company_id: 'company-1' }],
    messages: [{ id: 'message-1', body: 'Dzień dobry', sender_id: 'other', is_system: false, created_at: '2026-09-23T00:00:00Z' }],
    members: [{ profile_id: 'other' }],
    profiles: [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }],
    team: [],
    // Brak wiersza = firma nie jest zablokowana (#832).
    companyBlock: [],
  };
  for (const [stage, name] of Object.entries(ROW_QUERY) as Array<[Exclude<Stage, 'auth' | 'companyName'>, string]>) {
    fakeDb.rows(name, () => {
      if (failing === stage) throw failure;
      return rows[stage];
    });
  }
  // Nazwa firmy (0143) — RPC gejtowane `is_conversation_member`, nie odczyt tabeli `companies`.
  fakeDb.rpc('get_conversation_company_name', () => {
    if (failing === 'companyName') throw failure;
    return 'Firma';
  });
  fakeDb.rpc('get_message_attachments', []);
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

  it.each<Stage>(['auth', 'conversation', 'messages', 'members', 'profiles', 'companyName', 'team', 'companyBlock'])(
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

  describe('blokada firmy z wątku (#832)', () => {
    it('kandydat bez zapisanej blokady dostaje companyBlock z blocked=false', async () => {
      setup();
      const result = await getConversationThread('thread-1');
      expect(result).toMatchObject({
        status: 'ready',
        thread: { companyBlock: { companyId: 'company-1', companyName: 'Firma', blocked: false } },
      });
      expect(fakeDb.callsTo('messages.company-block')[0]!.values).toEqual([ME, 'company-1']);
    });

    it('kandydat z zapisaną blokadą dostaje companyBlock z blocked=true', async () => {
      resetFakeDb({ id: ME, role: 'candidate' } as PortalIdentity);
      const failure = pgError('XX000', 'private database detail');
      const rows: Record<Exclude<Stage, 'auth' | 'companyName'>, unknown[]> = {
        conversation: [{ id: 'thread-1', subject: 'Praca', company_id: 'company-1' }],
        messages: [{ id: 'message-1', body: 'Dzień dobry', sender_id: 'other', is_system: false, created_at: '2026-09-23T00:00:00Z' }],
        members: [{ profile_id: 'other' }],
        profiles: [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }],
        team: [],
        companyBlock: [{ blocked: 1 }],
      };
      for (const [stage, name] of Object.entries(ROW_QUERY) as Array<[Exclude<Stage, 'auth' | 'companyName'>, string]>) {
        fakeDb.rows(name, () => rows[stage]);
      }
      fakeDb.rpc('get_conversation_company_name', () => 'Firma');
      fakeDb.rpc('get_message_attachments', []);
      void failure;

      const result = await getConversationThread('thread-1');
      expect(result).toMatchObject({
        status: 'ready',
        thread: { companyBlock: { companyId: 'company-1', companyName: 'Firma', blocked: true } },
      });
    });

    // Kontrola ujemna: widz PO STRONIE FIRMY (aktywny członek — `team` zawiera ME) nie dostaje
    // kontrolki blokady (pracodawca nie blokuje sam siebie) i baza w ogóle nie jest o to pytana.
    it('widz po stronie firmy nie dostaje companyBlock (kontrola ujemna)', async () => {
      setup();
      fakeDb.rows('messages.company-members', () => [{ profile_id: ME }]);

      const result = await getConversationThread('thread-1');
      expect(result).toMatchObject({ status: 'ready', thread: { companyBlock: null } });
      expect(fakeDb.callsTo('messages.company-block')).toHaveLength(0);
    });

    it('rozmowa bez firmy (company_id null) nie dostaje companyBlock', async () => {
      resetFakeDb({ id: ME, role: 'candidate' } as PortalIdentity);
      fakeDb.rows('messages.conversation', () => [{ id: 'thread-1', subject: 'Praca', company_id: null }]);
      fakeDb.rows('messages.thread-page', () => []);
      fakeDb.rows('messages.thread-other-members', () => [{ profile_id: 'other' }]);
      fakeDb.rows('messages.profile-names', () => [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }]);
      fakeDb.rows('messages.company-members', () => []);
      fakeDb.rpc('get_message_attachments', []);

      const result = await getConversationThread('thread-1');
      expect(result).toMatchObject({ status: 'ready', thread: { companyBlock: null } });
      expect(fakeDb.callsTo('messages.company-block')).toHaveLength(0);
      expect(fakeDb.callsTo('get_conversation_company_name')).toHaveLength(0);
    });
  });
});
