// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Logowanie (Better Auth, #24) wraca do bezpiecznego `next` (np. oferty), a wartość spoza serwisu
 * jest ignorowana — przekierowanie do panelu (brak open redirect). Rola wynika wyłącznie z aktywnego
 * profilu odczytanego pod UUID z wyniku SDK; awaria/brak/nieznana rola → sesja cofnięta, błąd.
 * Rejestracja kandydata zapamiętuje bezpieczny `next` na czas potwierdzenia adresu (cookie).
 */

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import {
  USER_ID,
  api,
  authApiError,
  cookieJar,
  internalAdapter,
  profile,
  redirectTarget,
  resetPortal,
  stubPortalEnv,
  transactionUsers,
} from '../helpers/auth-portal';
import { registerCandidate, signIn } from '@/lib/actions/auth';

const credentials = { email: 'jan@example.com', password: 'Haslo1234' };

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
});
afterEach(() => vi.unstubAllEnvs());

describe('signIn — cel po zalogowaniu', () => {
  it('wraca do oferty wskazanej w next', async () => {
    const target = await redirectTarget(() => signIn(credentials, '/pl/oferty-pracy/murarz-bruksela-1002'));
    expect(target).toBe('/pl/oferty-pracy/murarz-bruksela-1002');
    // SDK dostaje wyłącznie zwalidowane dane i nagłówki bieżącego żądania.
    expect(api.signInEmail).toHaveBeenCalledWith({ body: credentials, headers: expect.any(Headers), returnHeaders: true });
  });

  it('bez next przekierowuje do panelu wg roli', async () => {
    profile.row = { role: 'employer' };
    expect(await redirectTarget(() => signIn(credentials))).toBe('/pl/employer');
  });

  it.each(['https://evil.example/pl', '//evil.example/pl', '/\\evil.example', 'javascript:alert(1)'])(
    'ignoruje niebezpieczny next %s i przekierowuje do panelu',
    async (next) => {
      expect(await redirectTarget(() => signIn(credentials, next))).toBe('/pl/candidate');
    },
  );

  it('nie przekierowuje, gdy logowanie się nie powiodło (także z next)', async () => {
    api.signInEmail.mockRejectedValue(authApiError(401, 'INVALID_EMAIL_OR_PASSWORD'));
    const result = await signIn(credentials, '/pl/oferty-pracy/x');
    expect(result).toEqual({ ok: false, error: 'AUTH_INVALID_CREDENTIALS' });
    expect(JSON.stringify(result)).not.toContain('message from SDK');
  });

  it('niepotwierdzony adres (dopiero po poprawnym haśle) → AUTH_EMAIL_NOT_CONFIRMED', async () => {
    api.signInEmail.mockRejectedValue(authApiError(403, 'EMAIL_NOT_VERIFIED'));
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'AUTH_EMAIL_NOT_CONFIRMED' });
  });

  it('bez konfiguracji kont (tryb demo) → INTERNAL bez wywołania SDK', async () => {
    vi.stubEnv('DATABASE_AUTH_URL', '');
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(api.signInEmail).not.toHaveBeenCalled();
  });

  it('niepoprawne dane formularza → VALIDATION_FAILED bez wywołania SDK', async () => {
    expect(await signIn({ email: 'nie-email', password: '' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(api.signInEmail).not.toHaveBeenCalled();
  });
});

describe('signIn — rola z profilu (#24)', () => {
  it.each(['candidate', 'employer', 'admin'])('rola %s prowadzi do własnego panelu', async (role) => {
    profile.row = { role };
    expect(await redirectTarget(() => signIn(credentials))).toBe(`/pl/${role}`);
    expect(internalAdapter.deleteSession).not.toHaveBeenCalled();
    // Tożsamość transakcji = UUID z wyniku SDK.
    expect(transactionUsers).toEqual([USER_ID]);
  });

  it.each([
    ['błąd odczytu', new Error('relation "profiles" does not exist (42P01)')],
    ['brak lub nieaktywny profil', null],
    ['nieznana rola', { role: 'moderator' }],
    ['rola pusta', { role: null }],
  ])('%s → kontrolowany błąd, sesja cofnięta, brak przekierowania (także z next)', async (_label, row) => {
    profile.row = row;
    for (const next of [undefined, '/pl/oferty-pracy/x']) {
      internalAdapter.deleteSession.mockClear();
      cookieJar.set('__Secure-better-auth.session_token', { value: 'session-token.sig' });
      const result = await signIn(credentials, next);
      expect(result).toEqual({ ok: false, error: 'INTERNAL' });
      expect(JSON.stringify(result)).not.toMatch(/profiles|42P01|relation/);
      expect(internalAdapter.deleteSession).toHaveBeenCalledWith('session-token');
      expect(cookieJar.has('__Secure-better-auth.session_token')).toBe(false);
    }
  });
});

describe('registerCandidate — cel po potwierdzeniu adresu', () => {
  const input = {
    ...credentials,
    passwordConfirm: credentials.password,
    firstName: 'Jan',
    lastName: 'Kowalski',
    agreeTerms: true as const,
    privacyNoticeAck: true as const,
    ageConfirmed: true as const,
    minAge: 18,
    locale: 'pl' as const,
  };

  it('zapamiętuje bezpieczny next w cookie HttpOnly', async () => {
    const target = await redirectTarget(() => registerCandidate(input, '/pl/oferty-pracy/x'));
    expect(target).toBe('/pl/potwierdzenie');
    expect(cookieJar.get('pb_verify_next')).toMatchObject({
      value: '/pl/oferty-pracy/x',
      options: { httpOnly: true, sameSite: 'lax', path: '/' },
    });
  });

  it('niebezpieczny next nie trafia do cookie', async () => {
    await redirectTarget(() => registerCandidate(input, '//evil.example'));
    expect(cookieJar.has('pb_verify_next')).toBe(false);
  });

  it('SDK dostaje e-mail małymi literami, hasło i imię z nazwiskiem — bez roli ani metadanych', async () => {
    await redirectTarget(() => registerCandidate({ ...input, email: 'Jan@Example.com' }, null));
    expect(api.signUpEmail).toHaveBeenCalledWith({
      body: { email: 'jan@example.com', password: 'Haslo1234', name: 'Jan Kowalski' },
      headers: expect.any(Headers),
    });
  });
});
