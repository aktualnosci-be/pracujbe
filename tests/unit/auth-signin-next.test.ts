// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Logowanie wraca do bezpiecznego `next` (np. oferty), a wartość spoza serwisu jest
 * ignorowana — przekierowanie do panelu (brak open redirect). Rejestracja kandydata
 * przenosi `next` do linku potwierdzenia e-maila.
 */

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public readonly target: unknown) {
      super('NEXT_REDIRECT');
    }
  }
  return {
    RedirectSignal,
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    role: 'candidate' as string,
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
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('brak klucza service-role w teście');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signUp: mocks.signUp },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { role: mocks.role } }) }),
      }),
    }),
  }),
}));

async function redirectTarget(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    if (e instanceof mocks.RedirectSignal) return e.target;
    throw e;
  }
  throw new Error('akcja nie przekierowała');
}

const credentials = { email: 'jan@example.com', password: 'Haslo1234' };

beforeEach(() => {
  mocks.role = 'candidate';
  mocks.signInWithPassword.mockReset().mockResolvedValue({
    data: { user: { id: '00000000-0000-4000-8000-000000000001' } },
    error: null,
  });
  mocks.signUp.mockReset().mockResolvedValue({ data: { user: null }, error: null });
});

describe('signIn — cel po zalogowaniu', () => {
  it('wraca do oferty wskazanej w next', async () => {
    const { signIn } = await import('@/lib/actions/auth');
    const target = await redirectTarget(() =>
      signIn(credentials, '/pl/oferty-pracy/murarz-bruksela-1002'),
    );
    expect(target).toBe('/pl/oferty-pracy/murarz-bruksela-1002');
  });

  it('bez next przekierowuje do panelu wg roli', async () => {
    mocks.role = 'employer';
    const { signIn } = await import('@/lib/actions/auth');
    expect(await redirectTarget(() => signIn(credentials))).toBe('/pl/employer');
  });

  it.each(['https://evil.example/pl', '//evil.example/pl', '/\\evil.example', 'javascript:alert(1)'])(
    'ignoruje niebezpieczny next %s i przekierowuje do panelu',
    async (next) => {
      const { signIn } = await import('@/lib/actions/auth');
      expect(await redirectTarget(() => signIn(credentials, next))).toBe('/pl/candidate');
    },
  );

  it('nie przekierowuje, gdy logowanie się nie powiodło (także z next)', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'invalid_credentials', status: 400 },
    });
    const { signIn } = await import('@/lib/actions/auth');
    await expect(signIn(credentials, '/pl/oferty-pracy/x')).resolves.toEqual({
      ok: false,
      error: 'AUTH_INVALID_CREDENTIALS',
    });
  });
});

describe('registerCandidate — next w linku potwierdzenia e-mail', () => {
  const input = {
    ...credentials,
    passwordConfirm: credentials.password,
    firstName: 'Jan',
    lastName: 'Kowalski',
    agreeTerms: true as const,
    locale: 'pl' as const,
  };

  function confirmationNext(): string | null {
    const options = mocks.signUp.mock.calls[0]?.[0]?.options as { emailRedirectTo: string };
    return new URL(options.emailRedirectTo).searchParams.get('next');
  }

  it('przekazuje bezpieczny next do /auth/callback', async () => {
    const { registerCandidate } = await import('@/lib/actions/auth');
    const target = await redirectTarget(() => registerCandidate(input, '/pl/oferty-pracy/x'));
    expect(target).toBe('/pl/potwierdzenie');
    expect(confirmationNext()).toBe('/pl/oferty-pracy/x');
  });

  it('niebezpieczny next zastępuje panelem kandydata', async () => {
    const { registerCandidate } = await import('@/lib/actions/auth');
    await redirectTarget(() => registerCandidate(input, '//evil.example'));
    expect(confirmationNext()).toBe('/pl/candidate');
  });
});
