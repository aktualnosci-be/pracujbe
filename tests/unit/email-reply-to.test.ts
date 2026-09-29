import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processAuthEmailBatch } from '@/lib/auth/email-worker';
import { processEmailQueue } from '@/lib/email/outbox';
import { replyToFromEnv } from '@/lib/email/sender';
import { emailLabsPayload } from '@/lib/email/transport/emaillabs';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * Reply-To (audyt CFG29-04, #1121/#1117): `EMAIL_REPLY_TO` był opisany w `.env.example` i
 * dokumentacji, ale żaden transport go nie czytał — potwierdzenie formularza kontaktu (i każdy
 * inny list z adresu `no-reply@`) wychodziło bez nagłówka. Teraz oba workery (kolejka domenowa
 * i kolejka kont) przekazują poprawny adres do transportu, a EmailLabs zapisuje go w nagłówkach.
 * Zła wartość = brak nagłówka (nigdy niepoprawny nagłówek), bez wartości = bez zmian.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => true,
}));

const REPLY_TO = 'Pracuj.be <kontakt@pracuj.be>';

function contactRow() {
  return {
    id: 'c1',
    profile_id: null,
    to_email: 'anna@example.test',
    template: 'supportContact',
    locale: 'pl',
    payload: { reference: 'KON-ABCD-1234', topic: 'technical', recipientName: 'Anna' },
    attempts: 0,
    lock_token: 'lock-c1',
  };
}

function queueContactConfirmation() {
  fakeDb.rpc('claim_email_batch', [contactRow()]);
  fakeDb.rpc('email_delivery_send_check', null);
  fakeDb.rpc('take_email_send_budget', [{ granted: true, retry_at: null }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null).exec('email.outbox.mark-sent').exec('email.outbox.mark-failed');
  process.env.RESEND_API_KEY = 're_test';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://pracuj.be';
  delete process.env.EMAIL_REPLY_TO;
  send.mockResolvedValue({ data: { id: 'provider-1' } });
});

describe('replyToFromEnv', () => {
  it('przyjmuje sam adres i „Nazwa <adres>”, bez wartości domyślnej', () => {
    expect(replyToFromEnv({})).toBeNull();
    expect(replyToFromEnv({ EMAIL_REPLY_TO: '  ' })).toBeNull();
    expect(replyToFromEnv({ EMAIL_REPLY_TO: 'kontakt@pracuj.be' })).toBe('kontakt@pracuj.be');
    expect(replyToFromEnv({ EMAIL_REPLY_TO: ` ${REPLY_TO} ` })).toBe(REPLY_TO);
  });

  it.each([
    ['nie adres', 'kontakt'],
    ['dwa adresy', 'a@pracuj.be, b@pracuj.be'],
    ['wstrzyknięcie nagłówka (CRLF)', 'kontakt@pracuj.be\r\nBcc: ofiara@example.com'],
    ['znak sterujący', 'kontakt@pracuj.be\u0000'],
    ['niedomknięty nawias', 'Pracuj.be <kontakt@pracuj.be'],
  ])('odrzuca: %s', (_label, value) => {
    expect(replyToFromEnv({ EMAIL_REPLY_TO: value })).toBeNull();
  });
});

describe('transport EmailLabs', () => {
  const base = { from: 'Pracuj.be <no-reply@pracuj.be>', to: 'anna@example.test', subject: 's', html: '<p>x</p>', text: 'x' };

  it('zapisuje Reply-To w nagłówkach; bez adresu nagłówka nie ma (kontrola ujemna)', () => {
    const withReply = emailLabsPayload({ ...base, replyTo: REPLY_TO }, 'id@pracuj.be', 'smtp');
    expect(withReply['headers']).toEqual({ 'Reply-To': REPLY_TO, 'X-TRACKING-OFF': '1' });
    const without = emailLabsPayload(base, 'id@pracuj.be', 'smtp');
    expect(without['headers']).toEqual({ 'X-TRACKING-OFF': '1' });
  });
});

describe('potwierdzenie formularza kontaktu (kolejka domenowa)', () => {
  it('EMAIL_REPLY_TO ustawiony → list wychodzi z replyTo, From bez zmian', async () => {
    process.env.EMAIL_REPLY_TO = REPLY_TO;
    queueContactConfirmation();
    expect(await processEmailQueue()).toMatchObject({ sent: 1, failed: 0 });
    const [message] = send.mock.calls[0]!;
    expect(message.replyTo).toBe(REPLY_TO);
    expect(message.from).toBe('Pracuj.be <no-reply@pracuj.be>');
  });

  it('kontrola ujemna: bez EMAIL_REPLY_TO albo z błędną wartością brak replyTo', async () => {
    queueContactConfirmation();
    await processEmailQueue();
    expect(send.mock.calls[0]![0]).not.toHaveProperty('replyTo');

    process.env.EMAIL_REPLY_TO = 'kontakt@pracuj.be\r\nBcc: x@example.com';
    queueContactConfirmation();
    await processEmailQueue();
    expect(send.mock.calls[1]![0]).not.toHaveProperty('replyTo');
  });
});

describe('kolejka kont (Better Auth)', () => {
  function pool() {
    return {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('expire_emails')) return { rows: [{ expired: 0 }] };
        if (sql.includes('claim_emails')) {
          const future = new Date(Date.now() + 60_000);
          return {
            rows: [{
              id: '11111111-1111-4111-8111-111111111111',
              user_id: '22222222-2222-4222-8222-222222222222',
              kind: 'verification',
              recipient_email: 'anna@example.com',
              first_name: 'Anna',
              recipient_role: 'employer',
              locale: 'nl',
              token: 'hdr.payload.sig',
              expires_at: future,
              lease_id: '33333333-3333-4333-8333-333333333333',
              lease_expires_at: future,
            }],
          };
        }
        if (sql.includes('take_send_budget')) return { rows: [{ granted: true, retry_at: null }] };
        if (sql.includes('complete_email')) return { rows: [{ completed: true }] };
        throw new Error(`nieoczekiwane zapytanie ${sql}`);
      }),
    };
  }
  const sender = { send: vi.fn(async (_message: unknown, _options: unknown) => ({ id: 'provider-1' })) };

  beforeEach(() => sender.send.mockClear());

  it('przekazuje replyTo z opcji workera; bez niego wiadomość go nie ma', async () => {
    await processAuthEmailBatch(pool() as never, sender, { baseURL: 'https://pracuj.be', from: 'x <x@pracuj.be>', replyTo: REPLY_TO });
    expect(sender.send.mock.calls[0]![0]).toMatchObject({ replyTo: REPLY_TO });

    await processAuthEmailBatch(pool() as never, sender, { baseURL: 'https://pracuj.be', from: 'x <x@pracuj.be>', replyTo: null });
    expect(sender.send.mock.calls[1]![0]).not.toHaveProperty('replyTo');
  });
});
