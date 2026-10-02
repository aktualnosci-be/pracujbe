// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Kontynuacja #1068: akcje kont (`src/lib/actions/auth.ts`) zgłaszają do kanału błędów tylko
 * błędy NIEOCZEKIWANE (wynik `INTERNAL`: nieznany błąd SDK, baza, sieć) — z obszarem akcji
 * i SQLSTATE, bez komunikatu i adresu e-mail. Oczekiwane wyniki (złe hasło, niepotwierdzony
 * e-mail, limit, zły link, walidacja) i tryb demo bez konfiguracji kont nie są zgłaszane.
 */

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));

import { api, authApiError, profile, resetPortal, runtimeModule, stubPortalEnv } from '../helpers/auth-portal';
import { registerCandidate, requestPasswordReset, signIn, updatePassword } from '@/lib/actions/auth';
import { setErrorReporter, type ErrorReport } from '@/lib/error-report';

const EMAIL = 'jan.kowalski@example.com';
const credentials = { email: EMAIL, password: 'Haslo1234' };
const registration = {
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
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';
const passwordInput = { password: 'NoweHaslo1', passwordConfirm: 'NoweHaslo1', token: TOKEN };

/** Błąd PostgreSQL z danymi w komunikacie, opakowany przez SDK w `cause`. */
function wrappedDbError(sqlstate: string): Error {
  const db = Object.assign(new Error(`Failing row contains (${EMAIL}, Kowalski)`), { code: sqlstate });
  return Object.assign(new Error(`Failed to create user ${EMAIL}`), { cause: db });
}

const reports: ErrorReport[] = [];

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  reports.length = 0;
  setErrorReporter((r) => reports.push(r));
});
afterEach(() => {
  setErrorReporter(null);
  vi.unstubAllEnvs();
});

function expectNoPii(): void {
  const text = JSON.stringify(reports);
  expect(text).not.toContain('example.com');
  expect(text).not.toContain('Kowalski');
}

describe('akcje kont — błędy nieoczekiwane trafiają do kanału', () => {
  it('signIn: nieznany błąd SDK → INTERNAL + jeden wpis z obszarem', async () => {
    api.signInEmail.mockRejectedValue(authApiError(500, 'SOMETHING_NEW'));
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'auth.signIn' }]);
    expectNoPii();
  });

  it('signIn: awaria inicjalizacji runtime (baza) → wpis z SQLSTATE, bez komunikatu', async () => {
    runtimeModule.getAuthRuntime.mockRejectedValueOnce(wrappedDbError('57P03'));
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'auth.signIn', sqlstate: '57P03' }]);
    expectNoPii();
  });

  it('signIn: błąd odczytu roli zgłoszony raz (obszar resolveRole), bez dubla z warstwy akcji', async () => {
    profile.row = new Error(`relation "profiles" does not exist ${EMAIL}`);
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'auth.signIn.resolveRole' }]);
    expectNoPii();
  });

  it('registerCandidate: błąd bazy opakowany przez SDK → wpis z SQLSTATE z łańcucha cause', async () => {
    api.signUpEmail.mockRejectedValue(wrappedDbError('XX000'));
    expect(await registerCandidate(registration)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'auth.registerCandidate', sqlstate: 'XX000' }]);
    expectNoPii();
  });

  it('updatePassword: nieznany błąd SDK → wpis', async () => {
    api.resetPassword.mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect(await updatePassword(passwordInput)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'auth.updatePassword' }]);
  });

  it('requestPasswordReset: awaria zlecenia → wynik neutralny, ale wpis w kanale', async () => {
    api.requestPasswordReset.mockRejectedValue(wrappedDbError('53300'));
    expect(await requestPasswordReset({ email: EMAIL })).toEqual({ ok: true });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'auth.requestPasswordReset', sqlstate: '53300' }]);
    expectNoPii();
  });
});

describe('kontrole ujemne: oczekiwane wyniki nie trafiają do kanału', () => {
  it.each([
    ['złe hasło', authApiError(401, 'INVALID_EMAIL_OR_PASSWORD'), 'AUTH_INVALID_CREDENTIALS'],
    ['niepotwierdzony e-mail', authApiError(403, 'EMAIL_NOT_VERIFIED'), 'AUTH_EMAIL_NOT_CONFIRMED'],
    ['limit SDK', authApiError(429, 'TOO_MANY_REQUESTS'), 'RATE_LIMITED'],
  ])('signIn: %s → kod bez wpisu', async (_label, error, code) => {
    api.signInEmail.mockRejectedValue(error);
    expect(await signIn(credentials)).toEqual({ ok: false, error: code });
    expect(reports).toEqual([]);
  });

  it('updatePassword: wygasły link → AUTH_LINK_INVALID bez wpisu', async () => {
    api.resetPassword.mockRejectedValue(authApiError(400, 'TOKEN_EXPIRED'));
    expect(await updatePassword(passwordInput)).toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
    expect(reports).toEqual([]);
  });

  it('requestPasswordReset: limit SDK → neutralny wynik bez wpisu', async () => {
    api.requestPasswordReset.mockRejectedValue(authApiError(429, 'TOO_MANY_REQUESTS'));
    expect(await requestPasswordReset({ email: EMAIL })).toEqual({ ok: true });
    expect(reports).toEqual([]);
  });

  it('registerCandidate: walidacja SDK → VALIDATION_FAILED bez wpisu', async () => {
    api.signUpEmail.mockRejectedValue(authApiError(400, 'PASSWORD_TOO_SHORT'));
    expect(await registerCandidate(registration)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(reports).toEqual([]);
  });

  it('tryb demo bez konfiguracji kont → INTERNAL bez wpisu', async () => {
    vi.stubEnv('DATABASE_AUTH_URL', '');
    expect(await signIn(credentials)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(await requestPasswordReset({ email: EMAIL })).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([]);
  });
});
