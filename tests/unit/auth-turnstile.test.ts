// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Actions auth sprawdzają Turnstile (#46) przed dotknięciem Supabase Auth. Globalny
 * `fetch` jest podmieniony — żadnych połączeń z Cloudflare.
 */

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public readonly target: unknown) {
      super('NEXT_REDIRECT');
    }
  }
  return {
    RedirectSignal,
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    rateLimit: vi.fn(),
  };
});

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new mocks.RedirectSignal(url);
  },
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: (args: { href: string; locale: string }) => {
    throw new mocks.RedirectSignal(`/${args.locale}${args.href}`);
  },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'candidate' }, error: null }) }) }),
    }),
  }),
}));

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
  agreeTerms: true,
  locale: 'pl' as const,
};

function siteverify(action: string) {
  return vi.fn(async () =>
    Response.json({ success: true, action, hostname: 'pracuj.be' }),
  );
}

async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof mocks.RedirectSignal) return { redirect: e.target };
    throw e;
  }
}

beforeEach(() => {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
  mocks.rateLimit.mockReset().mockResolvedValue(true);
  mocks.signUp.mockReset().mockResolvedValue({
    data: { user: { id: 'u1', email_confirmed_at: null, identities: [{ id: 'i1' }] } },
    error: null,
  });
  mocks.signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mocks.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
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
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: token z poprawną akcją przepuszcza rejestrację', async () => {
    vi.stubGlobal('fetch', siteverify('register'));
    expect(await outcome(() => registerCandidate(candidate, null, 'tok'))).toEqual({
      redirect: '/pl/potwierdzenie',
    });
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
  });

  it('token logowania nie działa przy rejestracji', async () => {
    vi.stubGlobal('fetch', siteverify('login'));
    expect(await registerCandidate(candidate, null, 'tok')).toEqual({ ok: false, error: 'BOT_CHECK_FAILED' });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('awaria Cloudflare = fail-closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(await registerCandidate(candidate, null, 'tok')).toEqual({
      ok: false,
      error: 'BOT_CHECK_UNAVAILABLE',
    });
    expect(mocks.signUp).not.toHaveBeenCalled();
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
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('awaria Cloudflare = fail-open (logowanie działa dalej)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await outcome(() => signIn(credentials, null, 'tok'))).toEqual({
      redirect: '/pl/candidate',
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe('reset hasła', () => {
  it('bez tokenu: odrzucony, e-mail nie jest wysyłany', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await requestPasswordReset({ email: 'jan@example.com' })).toEqual({
      ok: false,
      error: 'BOT_CHECK_FAILED',
    });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: poprawny token przepuszcza reset', async () => {
    vi.stubGlobal('fetch', siteverify('password_reset'));
    expect(await requestPasswordReset({ email: 'jan@example.com' }, 'tok')).toEqual({ ok: true });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1);
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
