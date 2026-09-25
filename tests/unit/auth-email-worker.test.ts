// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker kolejki wiadomości auth (#24): renderuje istniejące szablony w języku ODBIORCY (snapshot
 * z kolejki), link prowadzi do strony aplikacji z tokenem we fragmencie `#`, klucz idempotencji
 * dostawcy = UUID zlecenia. Porażka dostawcy/renderu zapisuje ustalony kod, nie komunikat.
 */

vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import { processAuthEmailBatch } from '@/lib/auth/email-worker';

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

function fakePool(rows: unknown[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('expire_emails')) return { rows: [{ expired: 0 }] };
      if (sql.includes('claim_emails')) return { rows };
      if (sql.includes('complete_email')) return { rows: [{ completed: true }] };
      if (sql.includes('fail_email')) return { rows: [{ recorded: true }] };
      throw new Error(`nieoczekiwane zapytanie ${sql}`);
    }),
  };
}

const send = vi.fn();

beforeEach(() => {
  send.mockReset().mockResolvedValue({ id: 'provider-1' });
});

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
    send.mockRejectedValueOnce(new Error('AUTH_EMAIL_PROVIDER_REJECTED'));
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

  it('błąd claimu → ok: false (cron widzi problem)', async () => {
    const pool = fakePool([{ niepoprawny: true }]);
    const result = await processAuthEmailBatch(pool as never, { send }, { baseURL, from: 'x <x@pracuj.be>' });
    expect(result).toMatchObject({ ok: false, skipped: 'claim error' });
  });
});
