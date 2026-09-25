// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Actions auth sprawdzają Turnstile (#46) przed dotknięciem Better Auth. Globalny
 * `fetch` jest podmieniony — żadnych połączeń z Cloudflare.
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

import { api, outcome, resetPortal, stubPortalEnv } from '../helpers/auth-portal';
import {
  registerCandidate,
  registerEmployer,
  requestPasswordReset,
  signIn,
} from '@/lib/actions/auth';

const candidate = {
  email: 'jan@example.com',
  password: 'Haslo1234',
  passwordConfirm: 'Haslo1234',
  firstName: 'Jan',
  lastName: 'Kowalski',
  agreeTerms: true as const,
  ageConfirmed: true as const,
  minAge: 18,
  locale: 'pl' as const,
};

function siteverify(action: string) {
  return vi.fn(async () =>
    Response.json({ success: true, action, hostname: 'pracuj.be' }),
  );
}

beforeEach(() => {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  resetPortal();
  stubPortalEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('rejestracja', () => {
  it('bez tokenu: odrzucona, konto nie powstaje', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await registerCandidate(candidate, null)).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(await registerEmployer({ ...candidate, companyName: 'Firma' })).toEqual({
      ok: false,
      error: 'BOT_CHECK_FAILED',
    });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: token z poprawną akcją przepuszcza rejestrację', async () => {
    vi.stubGlobal('fetch', siteverify('register'));
    expect(await outcome(() => registerCandidate(candidate, null, 'tok'))).toEqual({
      redirect: '/pl/potwierdzenie',
    });
    expect(api.signUpEmail).toHaveBeenCalledTimes(1);
  });

  it('token logowania nie działa przy rejestracji', async () => {
    vi.stubGlobal('fetch', siteverify('login'));
    expect(await registerCandidate(candidate, null, 'tok')).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });

  it('awaria Cloudflare = fail-closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(await registerCandidate(candidate, null, 'tok')).toEqual({
      ok: false,
      error: 'BOT_CHECK_UNAVAILABLE',
    });
    expect(api.signUpEmail).not.toHaveBeenCalled();
  });

  it('rate limit pozostaje pierwszą, niezależną warstwą', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    mocks.rateLimit.mockResolvedValue(false);
    expect(await registerCandidate(candidate, null, 'tok')).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('logowanie', () => {
  const credentials = { email: 'jan@example.com', password: 'Haslo1234' };

  it('bez tokenu: odrzucone', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await signIn(credentials, null)).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(api.signInEmail).not.toHaveBeenCalled();
  });

  it('awaria Cloudflare = fail-open (logowanie działa dalej)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await outcome(() => signIn(credentials, null, 'tok'))).toEqual({
      redirect: '/pl/candidate',
    });
    expect(api.signInEmail).toHaveBeenCalledTimes(1);
  });
});

describe('reset hasła', () => {
  it('bez tokenu: odrzucony, e-mail nie jest wysyłany', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await requestPasswordReset({ email: 'jan@example.com' })).toEqual({
      ok: false,
      error: 'BOT_CHECK_FAILED',
    });
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: poprawny token przepuszcza reset', async () => {
    vi.stubGlobal('fetch', siteverify('password_reset'));
    expect(await requestPasswordReset({ email: 'jan@example.com' }, 'tok')).toEqual({ ok: true });
    expect(api.requestPasswordReset).toHaveBeenCalledTimes(1);
  });
});

describe('tryb demo / E2E bez kluczy', () => {
  it('formularze działają bez tokenu', async () => {
    vi.stubEnv('APP_MODE', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    expect(await requestPasswordReset({ email: 'jan@example.com' })).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
