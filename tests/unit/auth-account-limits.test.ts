// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Limity prób liczone na konto/adres (bez adresu IP): logowanie, żądanie resetu hasła i
 * rejestracja. Identyfikator to skrót adresu (nie sam adres), a klucz nie zawiera IP.
 * Potwierdzenie adresu w przeglądarce z aktywną sesją nie nadpisuje jej nową sesją.
 */

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), verifyJWT: vi.fn() }));

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('better-auth/crypto', () => ({ verifyJWT: mocks.verifyJWT }));

import {
  SESSION_COOKIE,
  USER_ID,
  api,
  cookieJar,
  internalAdapter,
  outcome,
  redirectTarget,
  resetPortal,
  stubPortalEnv,
} from '../helpers/auth-portal';
import { confirmEmail, requestPasswordReset, signIn } from '@/lib/actions/auth';
import { accountRateLimitKey } from '@/lib/auth/account-rate-limit';

const ACCOUNT_ACTIONS = ['signin-account', 'password-reset-account', 'register-account'];
const credentials = { email: 'Jan@Example.com', password: 'Haslo1234' };

/** Limiter przekraczany tylko dla wskazanej akcji (limity IP przechodzą). */
function blockAction(action: string): void {
  mocks.rateLimit.mockImplementation(async (name: string) => name !== action);
}

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  mocks.rateLimit.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('klucz konta', () => {
  it('skrót niezależny od wielkości liter i spacji, bez adresu w treści', () => {
    expect(accountRateLimitKey(' Jan@Example.com ')).toBe(accountRateLimitKey('jan@example.com'));
    expect(accountRateLimitKey('jan@example.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(accountRateLimitKey('jan@example.com')).not.toContain('jan');
    expect(accountRateLimitKey('jan@example.com')).not.toBe(accountRateLimitKey('ola@example.com'));
  });
});

describe('logowanie: limit na konto', () => {
  it('woła limiter konta bez IP, ze skrótem adresu', async () => {
    await signIn(credentials).catch(() => undefined);
    const call = mocks.rateLimit.mock.calls.find(([a]) => a === 'signin-account');
    expect(call?.[1]).toMatchObject({
      perIp: false,
      identifier: accountRateLimitKey('jan@example.com'),
    });
    expect(JSON.stringify(call)).not.toContain('example.com');
  });

  it('po przekroczeniu: RATE_LIMITED bez próby hasła w SDK', async () => {
    blockAction('signin-account');
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(api.signInEmail).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: przekroczenie innego limitu konta nie blokuje logowania', async () => {
    blockAction('password-reset-account');
    expect(await redirectTarget(() => signIn(credentials))).toBe('/pl/candidate');
    expect(api.signInEmail).toHaveBeenCalled();
  });
});

describe('reset hasła: limit na odbiorcę', () => {
  it('ponad limit: wynik neutralny, bez zlecenia listu', async () => {
    blockAction('password-reset-account');
    expect(await requestPasswordReset({ email: 'jest@example.com' })).toEqual({ ok: true });
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('w limicie: zlecenie idzie do SDK; limit konta bez IP i ze skrótem adresu', async () => {
    expect(await requestPasswordReset({ email: 'Jest@example.com' })).toEqual({ ok: true });
    expect(api.requestPasswordReset).toHaveBeenCalledTimes(1);
    const call = mocks.rateLimit.mock.calls.find(([a]) => a === 'password-reset-account');
    expect(call?.[1]).toMatchObject({ perIp: false, identifier: accountRateLimitKey('jest@example.com') });
  });

  it('limit IP nadal zwraca RATE_LIMITED (jak dotąd)', async () => {
    blockAction('password-reset');
    expect(await requestPasswordReset({ email: 'jest@example.com' })).toEqual({ ok: false, error: 'RATE_LIMITED' });
  });
});

describe('limity konta są akcjami krytycznymi (fail-safe)', () => {
  it('lista akcji fail-safe zawiera limity kont', async () => {
    const src = (await import('node:fs')).readFileSync('src/lib/rate-limit.ts', 'utf8');
    for (const a of ACCOUNT_ACTIONS) expect(src).toContain(`'${a}'`);
  });
});

describe('potwierdzenie adresu w przeglądarce z aktywną sesją', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImpAZXgub3JnIn0.c2lnbmF0dXJl';
  function verified() {
    const headers = new Headers();
    headers.append('set-cookie', `${SESSION_COOKIE}=nowa.sig; Path=/; HttpOnly; Secure`);
    return { headers, response: { status: true, user: null } };
  }
  beforeEach(() => {
    mocks.verifyJWT.mockReset().mockResolvedValue({ email: 'j@ex.org' });
    api.verifyEmail.mockResolvedValue(verified());
    internalAdapter.findUserByEmail.mockResolvedValue({ user: { id: USER_ID, email: 'j@ex.org' } });
  });

  it('istniejąca sesja innego konta zostaje; nowa sesja unieważniona; przekierowanie do logowania', async () => {
    cookieJar.set(SESSION_COOKIE, { value: 'inne-konto.sig' });
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/pl/logowanie' });
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBe('inne-konto.sig');
    expect(internalAdapter.deleteUserSessions).toHaveBeenCalledWith(USER_ID);
  });

  it('kontrola ujemna: bez sesji w przeglądarce nowa sesja jest zapisana i prowadzi do panelu', async () => {
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/pl/candidate' });
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBe('nowa.sig');
    expect(internalAdapter.deleteUserSessions).not.toHaveBeenCalled();
  });
});
