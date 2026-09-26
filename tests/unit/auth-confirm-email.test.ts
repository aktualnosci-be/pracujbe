// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Potwierdzenie adresu (#24): token z linku (fragment `#token=`) wysyłany kliknięciem przycisku.
 * Pierwsze potwierdzenie wydaje sesję i kieruje do panelu wg roli z profilu; pracodawca dostaje
 * firmę idempotentnie (`bootstrapCompany` — blokada profilu, dowód współbieżności na PG:
 * tests/integration/bootstrap-company.test.ts). Konto już potwierdzone → logowanie.
 */

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), verifyJWT: vi.fn() }));

vi.mock('next-intl/server', () => ({ getLocale: async () => 'fr' }));
vi.mock('next/headers', async () => (await import('../helpers/auth-portal')).headersModule);
vi.mock('next/navigation', async () => (await import('../helpers/auth-portal')).navigationModule);
vi.mock('@/i18n/navigation', async () => (await import('../helpers/auth-portal')).intlNavigationModule);
vi.mock('@/lib/auth/runtime', async () => (await import('../helpers/auth-portal')).runtimeModule);
vi.mock('@/lib/db/runtime', async () => (await import('../helpers/auth-portal')).dbRuntimeModule);
vi.mock('@/lib/db/transaction', async () => (await import('../helpers/auth-portal')).transactionModule);
vi.mock('@/lib/auth/bootstrap-company', () => ({ bootstrapCompany: mocks.bootstrap }));
vi.mock('better-auth/crypto', () => ({ verifyJWT: mocks.verifyJWT }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import {
  SESSION_COOKIE,
  USER_ID,
  api,
  authApiError,
  cookieJar,
  internalAdapter,
  outcome,
  profile,
  resetPortal,
  stubPortalEnv,
} from '../helpers/auth-portal';
import { confirmEmail } from '@/lib/actions/auth';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImpAZXgub3JnIn0.c2lnbmF0dXJl';

function verified(sessionIssued: boolean) {
  const headers = new Headers();
  if (sessionIssued) headers.append('set-cookie', `${SESSION_COOKIE}=tok.sig; Path=/; HttpOnly; Secure`);
  return { headers, response: { status: true, user: null } };
}

beforeEach(() => {
  resetPortal();
  stubPortalEnv();
  mocks.bootstrap.mockReset().mockResolvedValue({ companyId: 'c1', created: true });
  mocks.verifyJWT.mockReset().mockResolvedValue({ email: 'j@ex.org' });
  api.verifyEmail.mockResolvedValue(verified(true));
  internalAdapter.findUserByEmail.mockResolvedValue({
    user: { id: USER_ID, email: 'j@ex.org', raw_user_meta_data: { company_name: 'Firma Testowa' } },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('confirmEmail', () => {
  it('kandydat: sesja wydana → panel kandydata w bieżącym języku', async () => {
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/fr/candidate' });
    expect(api.verifyEmail).toHaveBeenCalledWith(expect.objectContaining({ query: { token: TOKEN }, returnHeaders: true }));
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('kandydat wraca do zapamiętanej oferty; cookie celu jest zużyte', async () => {
    cookieJar.set('pb_verify_next', { value: '/fr/oferty-pracy/x' });
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/fr/oferty-pracy/x' });
    expect(cookieJar.has('pb_verify_next')).toBe(false);
  });

  it('niebezpieczny cel w cookie jest ignorowany', async () => {
    cookieJar.set('pb_verify_next', { value: '//evil.example' });
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/fr/candidate' });
  });

  it('pracodawca: firma z nazwy rejestracji, UUID z konta tokenu → panel pracodawcy', async () => {
    profile.row = { role: 'employer' };
    cookieJar.set('pb_verify_next', { value: '/fr/oferty-pracy/x' });
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/fr/employer' });
    expect(mocks.bootstrap).toHaveBeenCalledWith(expect.anything(), USER_ID, 'Firma Testowa');
  });

  it('awaria bootstrapu firmy nie blokuje wejścia (panel pokaże formularz firmy)', async () => {
    profile.row = { role: 'employer' };
    mocks.bootstrap.mockRejectedValue(new Error('db down'));
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/fr/employer' });
  });

  it('konto już potwierdzone (brak nowej sesji) → logowanie, bez bootstrapu', async () => {
    api.verifyEmail.mockResolvedValue(verified(false));
    profile.row = { role: 'employer' };
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ redirect: '/fr/logowanie' });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it.each(['INVALID_TOKEN', 'TOKEN_EXPIRED', 'USER_NOT_FOUND'])('%s → AUTH_LINK_INVALID', async (code) => {
    api.verifyEmail.mockRejectedValue(authApiError(401, code));
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
  });

  it.each(['', 'nie-jwt', 'a.b', `${'a'.repeat(4100)}.b.c`])('zniekształcony token „%s” nie trafia do SDK', async (token) => {
    expect(await outcome(() => confirmEmail(token))).toEqual({ ok: false, error: 'AUTH_LINK_INVALID' });
    expect(api.verifyEmail).not.toHaveBeenCalled();
  });

  it('nieznana rola po potwierdzeniu → sesje konta cofnięte, kontrolowany błąd', async () => {
    profile.row = null;
    expect(await outcome(() => confirmEmail(TOKEN))).toEqual({ ok: false, error: 'INTERNAL' });
    expect(internalAdapter.deleteUserSessions).toHaveBeenCalledWith(USER_ID);
  });
});
