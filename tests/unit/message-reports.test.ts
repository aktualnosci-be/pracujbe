import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { reportConversationContent } from '@/lib/actions/message-reports';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  MESSAGE_REPORT_CATEGORIES,
  MESSAGE_REPORT_DETAILS_MAX,
} from '@/lib/validation/message-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Zgłoszenia wiadomości i rozmów (0116): Server Action = walidacja i limiter przed RPC,
 * klucz idempotencji bez zmian, RPC pod tożsamością z sesji, kody użytkowe bez surowego
 * tekstu bazy (Invariant #8). Słownik powodów i limit opisu = wartości z migracji.
 * Logika domenowa (dostęp, dowód, jedna otwarta sprawa, niezmienność): rls.sql sekcja MR.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const MESSAGE = '66666666-6666-4666-8666-666666666666';
const KEY = '77777777-7777-4777-8777-777777777777';

const input = {
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  category: 'fraud' as const,
  details: '  Prośba o PIN  ',
  idempotencyKey: KEY,
};

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/0116_message_reports.sql'),
  'utf8',
);

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  fakeDb.rpc('report_conversation_content', { report_id: 'r-1', outcome: 'created' });
});

describe('kontrakt z migracją 0116', () => {
  it('słownik powodów = lista w RPC report_conversation_content', () => {
    const rpc = MIGRATION.slice(MIGRATION.indexOf('function public.report_conversation_content'));
    const list = /p_category not in\s*\(([^)]*)\)/.exec(rpc)?.[1] ?? '';
    const values = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...MESSAGE_REPORT_CATEGORIES]);
    // Każdy powód mieści się w ograniczeniu kategorii tabeli.
    const check = /reports_category_chk check \(([\s\S]*?)\n\);/.exec(MIGRATION)?.[1] ?? '';
    for (const value of MESSAGE_REPORT_CATEGORIES) expect(check).toContain(`'${value}'`);
  });

  it('limit opisu = limit w RPC i w ograniczeniu tabeli', () => {
    expect(MIGRATION).toContain(`char_length(v_details) > ${MESSAGE_REPORT_DETAILS_MAX}`);
    expect(MIGRATION).toContain(`char_length(details) <= ${MESSAGE_REPORT_DETAILS_MAX}`);
  });

  it('nowej wartości enumu nie ma jako literału w DDL (migracje w jednej transakcji)', () => {
    const ddl = MIGRATION.split('create or replace function')[0] ?? '';
    const outside = ddl.replace(/--.*$/gm, '').replace(/add value if not exists 'conversation'/, '');
    expect(outside).not.toMatch(/target_type\s*(=|in)\s*\(?\s*'conversation'/);
  });
});

describe('reportConversationContent', () => {
  it('sukces: RPC pod sesją, klucz bez zmian, opis przycięty', async () => {
    expect(await reportConversationContent(input)).toEqual({ ok: true, outcome: 'created' });
    expect(fakeDb.callsTo('report_conversation_content')[0]).toMatchObject({
      as: USER,
      args: {
        p_conversation_id: CONVERSATION,
        p_message_id: MESSAGE,
        p_category: 'fraud',
        p_details: 'Prośba o PIN',
        p_idempotency_key: KEY,
      },
    });
  });

  it('zgłoszenie rozmowy: messageId null, pusty opis → null', async () => {
    await reportConversationContent({ ...input, messageId: null, details: '   ' });
    expect(fakeDb.callsTo('report_conversation_content')[0]).toMatchObject({
      args: { p_message_id: null, p_details: null },
    });
  });

  it.each([
    ['powód spoza słownika', { category: 'nope' }],
    ['opis ponad limit', { details: 'x'.repeat(MESSAGE_REPORT_DETAILS_MAX + 1) }],
    ['zły identyfikator rozmowy', { conversationId: 'demo-conv-0' }],
    ['brak klucza', { idempotencyKey: '' }],
  ])('%s → VALIDATION_FAILED bez limitera i RPC', async (_name, patch) => {
    const result = await reportConversationContent({ ...input, ...patch } as typeof input);
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('limiter per konto przed RPC; przekroczony → RATE_LIMITED bez zapisu', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await reportConversationContent(input)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(checkRateLimit).toHaveBeenCalledWith(
      'message-report',
      expect.objectContaining({ identifier: USER, perIp: false }),
    );
    expect(fakeDb.callsTo('report_conversation_content')).toHaveLength(0);
  });

  it('bez sesji → PERMISSION_DENIED bez RPC', async () => {
    fakeSession.identity = null;
    expect(await reportConversationContent(input)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it.each(['duplicate', 'already_open'] as const)('wynik %s przekazany do UI', async (outcome) => {
    fakeDb.rpc('report_conversation_content', { report_id: null, outcome });
    expect(await reportConversationContent(input)).toEqual({ ok: true, outcome });
  });

  it('nieznany wynik RPC → INTERNAL (kontrola ujemna odczytu)', async () => {
    fakeDb.rpc('report_conversation_content', { report_id: 'r-1', outcome: 'maybe' });
    expect(await reportConversationContent(input)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it.each([
    ['NOT_FOUND', 'NOT_FOUND'],
    ['RATE_LIMITED', 'RATE_LIMITED'],
    ['VALIDATION_FAILED: wiadomości nie można zgłosić', 'VALIDATION_FAILED'],
    ['UNAUTHENTICATED', 'PERMISSION_DENIED'],
    ['duplicate key value violates unique constraint "reports_message_open_uq"', 'INTERNAL'],
  ])('błąd bazy %s → %s bez surowego tekstu', async (message, code) => {
    fakeDb.rpc('report_conversation_content', () => {
      throw pgError('P0001', message);
    });
    const result = await reportConversationContent(input);
    expect(result).toEqual({ ok: false, error: code });
    expect(JSON.stringify(result)).not.toContain('reports_message_open_uq');
  });

  it('tryb demo: bez bazy, poprawny powód → created; zły powód → VALIDATION_FAILED', async () => {
    fakeSession.configured = false;
    expect(
      await reportConversationContent({ ...input, conversationId: 'demo-conv-0', messageId: 'demo-1' }),
    ).toEqual({ ok: true, outcome: 'created' });
    expect(
      await reportConversationContent({ ...input, category: 'nope' } as unknown as typeof input),
    ).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
