// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker kolejki wiadomości auth (#24): renderuje istniejące szablony w języku ODBIORCY (snapshot
 * z kolejki), link prowadzi do strony aplikacji z tokenem we fragmencie `#`, klucz idempotencji
 * dostawcy = UUID zlecenia. Porażka dostawcy/renderu zapisuje ustalony kod, nie komunikat.
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const resendSend = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}));

import {
  AuthMailSendError,
  classifyProviderError,
  processAuthEmailBatch,
  resendSender,
} from '@/lib/auth/email-worker';
import { captureError } from '@/lib/error-report';

const baseURL = 'https://pracuj.be';
const future = () => new Date(Date.now() + 60_000);

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    kind: 'verification',
    recipient_email: 'anna@example.com',
    first_name: 'Anna',
    recipient_role: 'employer',
    locale: 'nl',
    token: 'hdr.payload.sig',
    expires_at: future(),
    lease_id: '33333333-3333-4333-8333-333333333333',
    lease_expires_at: future(),
    ...overrides,
  };
}

function fakePool(rows: unknown[], { completed = true, completeThrows = false } = {}) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('expire_emails')) return { rows: [{ expired: 0 }] };
      if (sql.includes('claim_emails')) return { rows };
      if (sql.includes('complete_email')) {
        if (completeThrows) throw new Error('connection terminated: anna@example.com hdr.payload.sig');
        return { rows: [{ completed }] };
      }
      if (sql.includes('fail_email')) return { rows: [{ recorded: true }] };
      throw new Error(`nieoczekiwane zapytanie ${sql}`);
    }),
  };
}

const send = vi.fn();

beforeEach(() => {
  send.mockReset().mockResolvedValue({ id: 'provider-1' });
  resendSend.mockReset();
  vi.mocked(captureError).mockClear();
});

/** Nic z tego, co trafia do kanału błędów, nie może zawierać tokenu ani adresu odbiorcy (#78). */
function expectNoSecretsInCapturedErrors() {
  const captured = JSON.stringify(vi.mocked(captureError).mock.calls.map(([error, context]) => [
    error instanceof Error ? { name: error.name, message: error.message } : error, context,
  ]));
  expect(captured).not.toContain('hdr.payload.sig');
  expect(captured).not.toContain('anna@example.com');
}

describe('processAuthEmailBatch', () => {
  it('potwierdzenie adresu: język odbiorcy, link do strony z tokenem we fragmencie, idempotencja', async () => {
    const pool = fakePool([delivery()]);
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'Pracuj.be <no-reply@pracuj.be>' });
    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0, ok: true });
    const [message, options] = send.mock.calls[0]!;
    expect(options).toEqual({ idempotencyKey: '11111111-1111-4111-8111-111111111111' });
    expect(message.to).toBe('anna@example.com');
    expect(message.html).toContain('https://pracuj.be/nl/potwierdz-email#token=hdr.payload.sig');
    expect(message.html).not.toContain('/api/auth/');
    expect(message.text.length).toBeGreaterThan(0);
    expect(pool.calls.find((c) => c.sql.includes('complete_email'))?.params).toEqual([
      '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'provider-1',
    ]);
  });

  it('reset hasła: strona ustawienia hasła w języku odbiorcy', async () => {
    const pool = fakePool([delivery({ kind: 'password_reset', locale: 'fr', token: 'AbCdEfGhIjKlMnOpQrStUvWx' })]);
    await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(send.mock.calls[0]![0].html).toContain('https://pracuj.be/fr/ustaw-nowe-haslo#token=AbCdEfGhIjKlMnOpQrStUvWx');
  });

  it('odrzucenie przez dostawcę → fail_email z ustalonym kodem, bez przerwania paczki', async () => {
    const pool = fakePool([delivery(), delivery({ id: '44444444-4444-4444-8444-444444444444' })]);
    send.mockRejectedValueOnce(new AuthMailSendError('delivery_failed'));
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ processed: 2, sent: 1, failed: 1, ok: true });
    expect(pool.calls.find((c) => c.sql.includes('fail_email'))?.params?.[2]).toBe('delivery_failed');
  });

  it('niekanoniczny origin → render_failed, list nie wychodzi', async () => {
    const pool = fakePool([delivery()]);
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL: 'http://pracuj.be', from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(pool.calls.find((c) => c.sql.includes('fail_email'))?.params?.[2]).toBe('render_failed');
  });

  it('dostawca niedostępny (wyjątek sieci) → fail_email provider_unavailable, bez tokenu i adresu w logach', async () => {
    const pool = fakePool([delivery()]);
    send.mockRejectedValueOnce(new Error('fetch failed for anna@example.com with hdr.payload.sig'));
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1, ok: true });
    expect(pool.calls.find((c) => c.sql.includes('fail_email'))?.params?.[2]).toBe('provider_unavailable');
    expect(pool.calls.some((c) => c.sql.includes('complete_email'))).toBe(false);
    expectNoSecretsInCapturedErrors();
  });

  it('ACK=false (stara dzierżawa) → nie liczy wysłania i nie woła fail_email', async () => {
    const pool = fakePool([delivery()], { completed: false });
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 0, stale: 1, ok: true });
    expect(pool.calls.some((c) => c.sql.includes('fail_email'))).toBe(false);
  });

  it('dostawca przyjął, zapis ACK zawiódł → ok: false, bez fail_email (ponowienie z tym samym kluczem)', async () => {
    const pool = fakePool([delivery()], { completeThrows: true });
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ sent: 0, failed: 0, ackErrors: 1, ok: false });
    expect(pool.calls.some((c) => c.sql.includes('fail_email'))).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('błąd claimu → ok: false (cron widzi problem)', async () => {
    const pool = fakePool([{ niepoprawny: true }]);
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ ok: false, skipped: 'claim error' });
  });
});

describe('transport Resend', () => {
  it.each([
    ['rate_limit_exceeded', 'provider_unavailable'],
    ['application_error', 'provider_unavailable'],
    ['internal_server_error', 'provider_unavailable'],
    ['concurrent_idempotent_requests', 'provider_unavailable'],
    ['validation_error', 'delivery_failed'],
    ['invalid_from_address', 'delivery_failed'],
    [undefined, 'delivery_failed'],
  ])('klasyfikacja błędu %s → %s', (name, code) => {
    expect(classifyProviderError(name)).toBe(code);
  });

  it('błąd dostawcy → AuthMailSendError z kodem, bez komunikatu dostawcy', async () => {
    resendSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'Invalid `to`: anna@example.com' } });
    const error = await resendSender('re_test').send(
      { from: 'x <x@pracuj.be>', to: 'anna@example.com', subject: 's', html: 'h', text: 't' },
      { idempotencyKey: 'k' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthMailSendError);
    expect((error as AuthMailSendError).code).toBe('delivery_failed');
    expect((error as Error).message).not.toContain('anna@example.com');
  });

  it('odpowiedź bez identyfikatora → brak ACK (provider_unavailable), klucz idempotencji przekazany', async () => {
    resendSend.mockResolvedValueOnce({ data: {}, error: null });
    const error = await resendSender('re_test').send(
      { from: 'x <x@pracuj.be>', to: 'a@b.c', subject: 's', html: 'h', text: 't' },
      { idempotencyKey: 'delivery-uuid' },
    ).catch((e: unknown) => e);
    expect((error as AuthMailSendError).code).toBe('provider_unavailable');
    expect(resendSend.mock.calls[0]![1]).toEqual({ idempotencyKey: 'delivery-uuid' });
  });
});
