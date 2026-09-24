// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reset hasła (#24): prośba zawsze neutralna (brak enumeracji, także przy awarii kolejki dla
 * istniejącego konta), ustawienie hasła WYMAGA tokenu z linku — sama sesja nie wystarcza.
 * Wylogowanie unieważnia sesję w bazie; awaria bazy i tak kasuje cookie tej przeglądarki.
 */

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn() }));

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import { SESSION_COOKIE, api, authApiError, cookieJar, outcome, resetPortal, stubPortalEnv } from '../helpers/auth-portal';
import { requestPasswordReset, signOut, updatePassword } from '@/lib/actions/auth';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';
const input = { password: 'NoweHaslo1', passwordConfirm: 'NoweHaslo1', token: TOKEN };

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  mocks.rateLimit.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('requestPasswordReset', () => {
  it('istniejące i nieistniejące konto dają ten sam wynik', async () => {
    expect(await requestPasswordReset({ email: 'jest@example.com' })).toEqual({ ok: true });
    expect(api.requestPasswordReset).toHaveBeenCalledWith({
      body: { email: 'jest@example.com' },
      headers: expect.any(Headers),
    });
  });

  it('awaria zapisu zlecenia (tylko istniejące konto) nie ujawnia konta — nadal neutralny sukces', async () => {
    api.requestPasswordReset.mockRejectedValue(authApiError(500, 'AUTH_EMAIL_QUEUE_FAILED'));
    expect(await requestPasswordReset({ email: 'jest@example.com' })).toEqual({ ok: true });
  });

  it('limit prób działa niezależnie od SDK', async () => {
    mocks.rateLimit.mockResolvedValue(false);
    expect(await requestPasswordReset({ email: 'jest@example.com' })).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('link i język wybiera kolejka z profilu odbiorcy — akcja nie przekazuje redirectTo ani języka', async () => {
    await requestPasswordReset({ email: 'jest@example.com' });
    expect(api.requestPasswordReset.mock.calls[0]![0].body).toEqual({ email: 'jest@example.com' });
  });
});

describe('updatePassword', () => {
  it('ustawia hasło tokenem z linku; brak nowej sesji (formularz prowadzi do logowania)', async () => {
    expect(await updatePassword(input)).toEqual({ ok: true });
    expect(api.resetPassword).toHaveBeenCalledWith({
      body: { newPassword: 'NoweHaslo1', token: TOKEN },
      headers: expect.any(Headers),
    });
  });

  it.each(['', 'krótki', 'zły/token.z-ukośnikiem-i-kropką'])('brak lub zły token „%s” → AUTH_LINK_INVALID bez SDK', async (token) => {
    expect(await updatePassword({ ...input, token })).toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it.each(['INVALID_TOKEN', 'TOKEN_EXPIRED'])('wygasły/użyty token (%s) → AUTH_LINK_INVALID, bez pozornego sukcesu', async (code) => {
    api.resetPassword.mockRejectedValue(authApiError(400, code));
    expect(await updatePassword(input)).toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
  });

  it('słabe albo różne hasła → VALIDATION_FAILED', async () => {
    expect(await updatePassword({ ...input, password: 'krotkie', passwordConfirm: 'krotkie' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await updatePassword({ ...input, passwordConfirm: 'InneHaslo1' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(api.resetPassword).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('unieważnia sesję przez SDK i przekierowuje do logowania', async () => {
    expect(await outcome(() => signOut())).toEqual({ redirect: '/pl/logowanie' });
    expect(api.signOut).toHaveBeenCalledWith({ headers: expect.any(Headers) });
  });

  it('awaria bazy: cookie tej przeglądarki i tak usunięte, przekierowanie do logowania', async () => {
    cookieJar.set(SESSION_COOKIE, { value: 'tok.sig' });
    api.signOut.mockRejectedValue(new Error('db down'));
    expect(await outcome(() => signOut())).toEqual({ redirect: '/pl/logowanie' });
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });
});
