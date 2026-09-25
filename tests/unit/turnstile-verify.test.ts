// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Serwerowa weryfikacja Cloudflare Turnstile (#46). Testy nigdy nie łączą się z Cloudflare —
 * `fetch` jest wstrzykiwany. Każdy przypadek sukcesu ma kontrolę ujemną (ta sama ścieżka ze
 * zmienionym jednym warunkiem musi się nie udać).
 */

const mocks = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: mocks.captureError }));

import {
  enforceTurnstile,
  isTurnstileEnabled,
  turnstileConfigState,
  turnstileDecision,
  verifyTurnstileToken,
} from '@/lib/turnstile/verify';
import { TURNSTILE_PROVIDER_FAILURE } from '@/lib/turnstile/policy';

const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function configure(): void {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
  vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', '');
  vi.stubEnv('APP_MODE', 'production');
}

beforeEach(() => mocks.captureError.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe('konfiguracja', () => {
  it('bez kluczy poza produkcją jest wyłączona i nie blokuje', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('APP_MODE', '');
    const fetchImpl = vi.fn();
    expect(turnstileConfigState()).toBe('disabled');
    expect(isTurnstileEnabled()).toBe(false);
    expect(await verifyTurnstileToken('register', undefined, { fetchImpl })).toEqual({
      status: 'skipped',
    });
    expect(await enforceTurnstile('register', undefined, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('bez kluczy w produkcji: rejestracja i reset odrzucone, logowanie przepuszczone', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('APP_MODE', 'production');
    const fetchImpl = vi.fn();
    expect(turnstileConfigState()).toBe('unconfigured');
    expect(await enforceTurnstile('register', TOKEN, { fetchImpl })).toBe('BOT_CHECK_UNAVAILABLE');
    expect(await enforceTurnstile('passwordReset', TOKEN, { fetchImpl })).toBe(
      'BOT_CHECK_UNAVAILABLE',
    );
    expect(await enforceTurnstile('login', TOKEN, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    // Sygnał operacyjny bez tokenu w kontekście.
    expect(mocks.captureError).toHaveBeenCalled();
    expect(JSON.stringify(mocks.captureError.mock.calls)).not.toContain(TOKEN);
  });

  it.each([
    ['tylko klucz witryny', 'site-key', ''],
    ['tylko sekret', '', 'secret-key'],
  ])('połowiczna konfiguracja (%s) poza produkcją też jest błędem, nie wyłączeniem', (_l, site, secret) => {
    vi.stubEnv('APP_MODE', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', site);
    vi.stubEnv('TURNSTILE_SECRET_KEY', secret);
    expect(turnstileConfigState()).toBe('unconfigured');
  });

  it('oba klucze = włączona', () => {
    configure();
    expect(turnstileConfigState()).toBe('enabled');
    expect(isTurnstileEnabled()).toBe(true);
  });
});

describe('weryfikacja siteverify', () => {
  beforeEach(configure);

  it('sukces: poprawna akcja i hostname', async () => {
    const fetchImpl = jsonFetch({ success: true, action: 'register', hostname: 'pracuj.be' });
    expect(await verifyTurnstileToken('register', TOKEN, { fetchImpl })).toEqual({ status: 'passed' });
    expect(await enforceTurnstile('register', TOKEN, { fetchImpl })).toBeNull();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('secret-key');
    expect(body.get('response')).toBe(TOKEN);
    expect(body.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/);
    // Bez IP klienta w zapytaniu.
    expect(body.has('remoteip')).toBe(false);
  });

  it('kontrola ujemna: token wydany dla innej akcji jest odrzucany', async () => {
    const fetchImpl = jsonFetch({ success: true, action: 'login', hostname: 'pracuj.be' });
    expect(await verifyTurnstileToken('register', TOKEN, { fetchImpl })).toEqual({
      status: 'rejected',
      reason: 'action_mismatch',
    });
    expect(await enforceTurnstile('register', TOKEN, { fetchImpl })).toBe('BOT_CHECK_FAILED');
  });

  it('kontrola ujemna: token z obcego hostname jest odrzucany', async () => {
    const fetchImpl = jsonFetch({ success: true, action: 'register', hostname: 'evil.example' });
    expect(await verifyTurnstileToken('register', TOKEN, { fetchImpl })).toMatchObject({
      status: 'rejected',
      reason: 'hostname_mismatch',
    });
  });

  it('TURNSTILE_ALLOWED_HOSTNAMES zastępuje host z NEXT_PUBLIC_SITE_URL', async () => {
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', 'www.pracuj.be, staging.pracuj.be');
    const ok = jsonFetch({ success: true, action: 'login', hostname: 'staging.pracuj.be' });
    expect(await verifyTurnstileToken('login', TOKEN, { fetchImpl: ok })).toEqual({ status: 'passed' });
    const other = jsonFetch({ success: true, action: 'login', hostname: 'pracuj.be' });
    expect(await verifyTurnstileToken('login', TOKEN, { fetchImpl: other })).toMatchObject({
      reason: 'hostname_mismatch',
    });
  });

  it('porażka: ponowne użycie tokenu (timeout-or-duplicate) jest odrzucane w każdym przepływie', async () => {
    const fetchImpl = jsonFetch({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    for (const flow of ['login', 'register', 'passwordReset'] as const) {
      expect(await enforceTurnstile(flow, TOKEN, { fetchImpl })).toBe('BOT_CHECK_FAILED');
    }
    // Odrzucenie tokenu nie jest awarią — bez zgłoszeń do monitoringu.
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it('porażka: nieprawidłowy token', async () => {
    const fetchImpl = jsonFetch({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await verifyTurnstileToken('login', TOKEN, { fetchImpl })).toEqual({
      status: 'rejected',
      reason: 'invalid_token',
      codes: ['invalid-input-response'],
    });
  });

  it.each([undefined, null, '', 42, 'x'.repeat(2049)])(
    'brak tokenu (%s) jest odrzucany bez zapytania do Cloudflare, także przy logowaniu',
    async (token) => {
      const fetchImpl = vi.fn();
      expect(await enforceTurnstile('login', token, { fetchImpl })).toBe('BOT_CHECK_FAILED');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('timeout: przerwane zapytanie = niedostępny dostawca wg polityki przepływu', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    expect(await verifyTurnstileToken('register', TOKEN, { fetchImpl, timeoutMs: 10 })).toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
    expect(await enforceTurnstile('register', TOKEN, { fetchImpl, timeoutMs: 10 })).toBe(
      'BOT_CHECK_UNAVAILABLE',
    );
    expect(await enforceTurnstile('login', TOKEN, { fetchImpl, timeoutMs: 10 })).toBeNull();
    expect(mocks.captureError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.captureError.mock.calls)).not.toContain(TOKEN);
  });

  it.each([
    ['błąd sieci', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))), 'network'],
    ['HTTP 500', jsonFetch({}, 500), 'provider_error'],
    ['nie-JSON', vi.fn(async () => new Response('<html>', { status: 200 })), 'bad_response'],
    ['internal-error', jsonFetch({ success: false, 'error-codes': ['internal-error'] }), 'provider_error'],
    ['zły sekret', jsonFetch({ success: false, 'error-codes': ['invalid-input-secret'] }), 'provider_error'],
  ])('awaria dostawcy (%s) nie jest mylona ze złym tokenem', async (_l, fetchImpl, reason) => {
    const result = await verifyTurnstileToken('passwordReset', TOKEN, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason });
  });
});

describe('polityka przepływów', () => {
  it('logowanie fail-open, rejestracja/reset/kontakt/zgłoszenia fail-closed', () => {
    expect(TURNSTILE_PROVIDER_FAILURE).toEqual({
      login: 'open',
      register: 'closed',
      passwordReset: 'closed',
      contact: 'closed',
      report: 'closed',
      guestApply: 'closed',
    });
  });

  it('odrzucony token blokuje niezależnie od polityki awarii', () => {
    for (const flow of Object.keys(TURNSTILE_PROVIDER_FAILURE) as (keyof typeof TURNSTILE_PROVIDER_FAILURE)[]) {
      expect(turnstileDecision(flow, { status: 'rejected', reason: 'invalid_token' })).toBe(
        'BOT_CHECK_FAILED',
      );
    }
  });
});
