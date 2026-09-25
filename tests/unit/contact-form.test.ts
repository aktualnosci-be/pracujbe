// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #61 — formularz kontaktu: kolejność ochron w Server Action (limiter → Turnstile `contact`
 * → walidacja), kontrakt z RPC `submit_contact_message` (0125) wołanym pulą service,
 * tożsamość nadawcy wyłącznie z sesji serwera, minimalizacja (NISS/PESEL/numer dokumentu
 * odrzucony przy polu, zanim cokolwiek trafi do bazy) i mapowanie błędów bez technikaliów.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => true),
  turnstile: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: mocks.turnstile }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

import { submitContactMessage } from '@/lib/actions/contact';
import { TURNSTILE_PROVIDER_FAILURE } from '@/lib/turnstile/policy';
import { contactFormSchema, contactSchema } from '@/lib/validation/contact';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

const USER = '7d7e5c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';
const KEY = '0f9a5c3e-1b2d-4e6f-8a7b-9c0d1e2f3a4b';
// Poprawny belgijski numer rejestru narodowego (suma mod 97) — tylko do testu odrzucenia.
const NISS = '85.07.30-033.28';

function input(overrides: Record<string, unknown> = {}) {
  return {
    topic: 'technical' as const,
    message: 'Nie mogę zapisać kroku piątego w kreatorze profilu.',
    senderName: '',
    senderEmail: 'nadawca@example.com',
    locale: 'nl' as const,
    idempotencyKey: KEY,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(true);
  mocks.turnstile.mockResolvedValue(null);
  resetFakeDb(null).rpc('submit_contact_message', [
    { message_id: 'm1', reference: 'KON-1A2B-3C4D', created: true },
  ]);
});

describe('submitContactMessage', () => {
  it('gość: RPC pulą service z senderId = null, polami formularza i językiem formularza', async () => {
    const result = await submitContactMessage(input(), 'token');
    expect(result).toEqual({ ok: true, reference: 'KON-1A2B-3C4D', created: true });
    expect(mocks.rateLimit).toHaveBeenCalledWith('contact', { max: 5, windowSeconds: 3600 });
    expect(mocks.turnstile).toHaveBeenCalledWith('contact', 'token');
    const [call] = fakeDb.callsTo('submit_contact_message');
    expect(call?.as).toBe('service');
    expect(call?.args).toEqual({
      p_sender_id: null,
      p_idempotency_key: KEY,
      p_topic: 'technical',
      p_message: 'Nie mogę zapisać kroku piątego w kreatorze profilu.',
      p_sender_name: null,
      p_sender_email: 'nadawca@example.com',
      p_locale: 'nl',
    });
  });

  it('zalogowany: senderId z sesji serwera, nie z danych klienta', async () => {
    fakeSession.identity = { id: USER, role: 'candidate' };
    await submitContactMessage({ ...input(), senderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } as never, 't');
    expect(fakeDb.callsTo('submit_contact_message')[0]?.args['p_sender_id']).toBe(USER);
  });

  it('limiter przed wszystkim: odmowa → RATE_LIMITED bez Turnstile i bez bazy', async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect(await submitContactMessage(input(), 'token')).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(mocks.turnstile).not.toHaveBeenCalled();
    expect(fakeDb.callsTo('submit_contact_message')).toEqual([]);
  });

  it('Turnstile odrzuca → kod błędu bez bazy; polityka contact = fail-closed', async () => {
    mocks.turnstile.mockResolvedValue('BOT_CHECK_UNAVAILABLE');
    expect(await submitContactMessage(input(), null)).toEqual({ ok: false, error: 'BOT_CHECK_UNAVAILABLE' });
    expect(fakeDb.callsTo('submit_contact_message')).toEqual([]);
    expect(TURNSTILE_PROVIDER_FAILURE.contact).toBe('closed');
  });

  it('NISS w treści → błąd przy polu message, bez zapisu', async () => {
    const result = await submitContactMessage(input({ message: `Mój numer rejestru to ${NISS}, proszę o pomoc.` }), 't');
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED', field: 'message' });
    expect(fakeDb.callsTo('submit_contact_message')).toEqual([]);
  });

  it('kontrola ujemna detektora: ta sama treść bez numeru przechodzi', async () => {
    const result = await submitContactMessage(input({ message: 'Mój numer rejestru nie jest potrzebny, proszę o pomoc.' }), 't');
    expect(result.ok).toBe(true);
  });

  it('nieprawidłowe dane (zły temat, za krótko, zły e-mail) → VALIDATION_FAILED bez bazy', async () => {
    for (const bad of [{ topic: 'spam' }, { message: 'krótko' }, { senderEmail: 'nie-adres' }, { locale: 'de' }]) {
      expect(await submitContactMessage(input(bad), 't')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(fakeDb.callsTo('submit_contact_message')).toEqual([]);
  });

  it('tryb demo: brak zapisu i jawny kod DEMO_UNAVAILABLE', async () => {
    fakeSession.serviceConfigured = false;
    expect(await submitContactMessage(input(), 'token')).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
  });

  it.each([
    ['RATE_LIMITED', 'RATE_LIMITED'],
    ['VALIDATION_FAILED: treść', 'VALIDATION_FAILED'],
    ['relation "contact_messages" violates check constraint', 'INTERNAL'],
  ])('błąd bazy „%s” → %s (bez technikaliów)', async (message, code) => {
    fakeDb.rpc('submit_contact_message', () => {
      throw pgError('P0001', message);
    });
    expect(await submitContactMessage(input(), 'token')).toEqual({ ok: false, error: code });
  });

  it('odpowiedź bez poprawnego numeru → INTERNAL (nie „sukces” bez numeru)', async () => {
    fakeDb.rpc('submit_contact_message', [{ message_id: 'm1', reference: 'x', created: true }]);
    expect(await submitContactMessage(input(), 'token')).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('contactSchema', () => {
  it('komunikaty błędów to klucze i18n przy polach', () => {
    const r = contactFormSchema.safeParse({ message: '', senderName: '', senderEmail: '' });
    expect(r.success).toBe(false);
    // Pierwszy komunikat pola = ten, który widzi użytkownik (RHF pokazuje pierwszy błąd).
    const byField: Record<string, string> = {};
    for (const issue of r.success ? [] : r.error.issues) byField[String(issue.path[0])] ??= issue.message;
    expect(byField).toMatchObject({
      topic: 'contact.error.topicRequired',
      message: 'contact.error.messageRequired',
      senderEmail: 'contact.error.emailRequired',
    });
  });

  it('numer dokumentu w imieniu też odrzucony (pole senderName)', () => {
    const r = contactSchema.safeParse(input({ senderName: `Jan ${NISS}` }));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0])).toContain('senderName');
  });
});
