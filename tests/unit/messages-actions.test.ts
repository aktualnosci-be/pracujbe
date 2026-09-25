import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { loadOlderMessages, markConversationRead, openConversation, sendMessage } from '@/lib/actions/messages';
import { getOlderThreadMessages } from '@/lib/data/messages';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #25 (z #350/#147) — Server Actions wiadomości na transakcji sesji: walidacja i limit przed RPC,
 * klucz operacji (`client_message_id`) przekazany bez zmian, RPC pod tożsamością z sesji,
 * błędy bazy zamienione na kody użytkowe bez surowego tekstu (Invariant #8).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/data/messages', () => ({ getOlderThreadMessages: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const OFFER = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const CLIENT_MSG = '66666666-6666-4666-8666-666666666666';

const PG_ERRORS: Array<[string, string]> = [
  ['NOT_FOUND: job', 'NOT_FOUND'],
  ['VALIDATION_FAILED: body', 'VALIDATION_FAILED'],
  ['PERMISSION_DENIED', 'PERMISSION_DENIED'],
  ['UNAUTHENTICATED', 'PERMISSION_DENIED'],
  ['new row violates row-level security policy for table "messages"', 'PERMISSION_DENIED'],
  ['duplicate key value violates unique constraint "messages_pkey"', 'INTERNAL'],
];

function expectNoTechnicalText(result: unknown, pgMessage: string) {
  const serialized = JSON.stringify(result);
  for (const word of ['violates', 'policy', 'constraint', 'table']) {
    if (pgMessage.includes(word)) expect(serialized).not.toContain(word);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  for (const fn of ['get_or_create_conversation', 'send_message']) fakeDb.rpc(fn, 'row-1');
  fakeDb.rpc('mark_conversation_read', null);
});

describe('wiadomości', () => {
  it('openConversation: dokładnie jedna relacja, inaczej VALIDATION_FAILED bez RPC', async () => {
    expect(await openConversation({})).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await openConversation({ applicationId: JOB, offerId: OFFER })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
    expect(await openConversation({ offerId: OFFER })).toEqual({ ok: true, id: 'row-1' });
    expect(fakeDb.callsTo('get_or_create_conversation')[0]).toMatchObject({
      args: { p_application_id: null, p_offer_id: OFFER },
      as: USER,
    });
  });

  it('sendMessage: sukces pod sesją i limit przed RPC', async () => {
    expect(await sendMessage(CONVERSATION, 'Dzień dobry, kiedy mogę przyjść?', CLIENT_MSG)).toEqual({
      ok: true,
      id: 'row-1',
    });
    expect(fakeDb.callsTo('send_message')[0]).toMatchObject({
      args: {
        p_conversation_id: CONVERSATION,
        p_body: 'Dzień dobry, kiedy mogę przyjść?',
        p_client_message_id: CLIENT_MSG,
      },
      as: USER,
    });
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await sendMessage(CONVERSATION, 'Druga wiadomość', CLIENT_MSG)).toEqual({
      ok: false,
      error: 'RATE_LIMITED',
    });
    expect(fakeDb.callsTo('send_message')).toHaveLength(1);
  });

  it('sendMessage: ponowienie z tym samym kluczem wysyła do RPC identyczny klucz (#147)', async () => {
    await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG);
    await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG);
    expect(fakeDb.callsTo('send_message').map((call) => call.args['p_client_message_id'])).toEqual([CLIENT_MSG, CLIENT_MSG]);
  });

  it('sendMessage: pusta treść → VALIDATION_FAILED bez RPC', async () => {
    expect(await sendMessage(CONVERSATION, '   ', CLIENT_MSG)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('sendMessage z załącznikami (0108): identyfikatory do RPC, pusta treść tylko z plikiem', async () => {
    const A1 = '77777777-7777-4777-8777-777777777771';
    const A2 = '77777777-7777-4777-8777-777777777772';
    expect(await sendMessage(CONVERSATION, '  ', CLIENT_MSG, [A1, A2])).toEqual({ ok: true, id: 'row-1' });
    expect(fakeDb.callsTo('send_message')[0]).toMatchObject({
      args: { p_body: '', p_client_message_id: CLIENT_MSG, p_attachment_ids: [A1, A2] },
      as: USER,
    });
    // Bez załączników lista jest pusta (RPC ma wartość domyślną, ale przekazujemy jawnie).
    await sendMessage(CONVERSATION, 'Tekst', CLIENT_MSG);
    expect(fakeDb.callsTo('send_message')[1]!.args['p_attachment_ids']).toEqual([]);
    // Kontrole ujemne: > 3 pliki, duplikat, nie-UUID — bez RPC.
    fakeDb.calls.length = 0;
    const four = [A1, A2, '77777777-7777-4777-8777-777777777773', '77777777-7777-4777-8777-777777777774'];
    expect(await sendMessage(CONVERSATION, 'x', CLIENT_MSG, four)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await sendMessage(CONVERSATION, 'x', CLIENT_MSG, [A1, A1])).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await sendMessage(CONVERSATION, 'x', CLIENT_MSG, ['plik'])).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(['', 'msg-1', `${CLIENT_MSG}x`])('sendMessage: klucz operacji „%s” nie-UUID → VALIDATION_FAILED bez RPC (#147)', async (key) => {
    expect(await sendMessage(CONVERSATION, 'Dzień dobry', key)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('bez sesji: PERMISSION_DENIED bez zapytań; tryb demo: atrapa bez bazy', async () => {
    fakeSession.identity = null;
    expect(await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await openConversation({ applicationId: JOB })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await markConversationRead(CONVERSATION)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
    fakeSession.configured = false;
    expect(await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG)).toEqual({ ok: true, id: 'demo' });
    expect(await openConversation({ applicationId: JOB })).toEqual({ ok: true, id: 'demo' });
    expect(await markConversationRead(CONVERSATION)).toEqual({ ok: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(PG_ERRORS)('sendMessage/openConversation/markConversationRead: „%s” → %s', async (message, code) => {
    for (const fn of ['get_or_create_conversation', 'send_message', 'mark_conversation_read']) {
      fakeDb.rpc(fn, () => { throw pgError('P0001', message); });
    }
    for (const result of [
      await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG),
      await openConversation({ applicationId: JOB }),
      await markConversationRead(CONVERSATION),
    ]) {
      expect(result).toEqual({ ok: false, error: code });
      expectNoTechnicalText(result, message);
    }
  });

  it('wyjątek spoza bazy → INTERNAL', async () => {
    fakeDb.rpc('send_message', () => { throw new Error('ECONNRESET 10.0.0.1'); });
    expect(await sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_MSG)).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('loadOlderMessages', () => {
  const CURSOR = { createdAt: '2026-09-20T10:00:00.000Z', id: OFFER };

  it.each([
    ['nieobsługiwany język', 'de', CONVERSATION, CURSOR],
    ['konwersacja nie-UUID', 'pl', 'c-1', CURSOR],
    ['kursor bez daty', 'pl', CONVERSATION, { id: OFFER }],
  ])('%s → error bez odczytu', async (_label, locale, conversation, cursor) => {
    expect(await loadOlderMessages(locale, conversation, cursor)).toEqual({ status: 'error' });
    expect(getOlderThreadMessages).not.toHaveBeenCalled();
  });

  it('strona starszych wiadomości: odczyt pod sesją i etykieta czasu w języku strony', async () => {
    const message = { id: JOB, body: 'Dzień dobry', createdAt: '2026-09-19T08:30:00.000Z', mine: false };
    vi.mocked(getOlderThreadMessages).mockResolvedValue({
      status: 'ready',
      messages: [message],
      olderCursor: null,
    } as never);
    const result = await loadOlderMessages('nl', CONVERSATION, CURSOR);
    expect(getOlderThreadMessages).toHaveBeenCalledWith(CONVERSATION, CURSOR);
    expect(result).toMatchObject({ status: 'ready', olderCursor: null, messages: [{ id: JOB, body: 'Dzień dobry' }] });
    expect(result.status === 'ready' && typeof result.messages[0]!.timeLabel).toBe('string');
  });

  it.each(['not-found', 'error'] as const)('wynik odczytu %s przekazany bez zmian', async (status) => {
    vi.mocked(getOlderThreadMessages).mockResolvedValue({ status } as never);
    expect(await loadOlderMessages('pl', CONVERSATION, CURSOR)).toEqual({ status });
  });
});
