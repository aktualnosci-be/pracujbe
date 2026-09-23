// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Zgoda na regulamin przy rejestracji jest sprawdzana na SERWERZE: żądanie bez zgody
 * nie tworzy konta, a konto bez zapisanego receiptu akceptacji nie zostaje.
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
    rpc: vi.fn(),
    deleteUser: vi.fn(),
    update: vi.fn(),
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
  createAdminClient: () => ({
    rpc: mocks.rpc,
    auth: { admin: { deleteUser: mocks.deleteUser } },
    from: () => ({ update: (v: unknown) => ({ eq: async () => mocks.update(v) }) }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { signUp: mocks.signUp } }),
}));

const USER_ID = '00000000-0000-4000-8000-0000000000aa';

const candidate = {
  email: 'jan@example.com',
  password: 'Haslo1234',
  passwordConfirm: 'Haslo1234',
  firstName: 'Jan',
  lastName: 'Kowalski',
  locale: 'pl' as const,
};
const employer = { ...candidate, companyName: 'Firma Testowa' };

async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof mocks.RedirectSignal) return { redirect: e.target };
    throw e;
  }
}

beforeEach(() => {
  mocks.signUp.mockReset().mockResolvedValue({
    data: { user: { id: USER_ID, email_confirmed_at: null, identities: [{ id: 'i1' }] } },
    error: null,
  });
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.deleteUser.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.update.mockReset().mockReturnValue({ error: null });
});

describe('rejestracja bez zgody na regulamin', () => {
  const withoutConsent: Array<[string, Record<string, unknown>]> = [
    ['brak pola', {}],
    ['false', { agreeTerms: false }],
    ['napis "true"', { agreeTerms: 'true' }],
    ['1', { agreeTerms: 1 }],
  ];

  it.each(withoutConsent)('kandydat (%s) — odrzucone, konto nie powstaje', async (_label, extra) => {
    const { registerCandidate } = await import('@/lib/actions/auth');
    const result = await outcome(() => registerCandidate({ ...candidate, ...extra } as never));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(withoutConsent)('pracodawca (%s) — odrzucone, konto nie powstaje', async (_label, extra) => {
    const { registerEmployer } = await import('@/lib/actions/auth');
    const result = await outcome(() => registerEmployer({ ...employer, ...extra } as never));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
});

describe('rejestracja ze zgodą — receipt akceptacji jest obowiązkowy', () => {
  it('zapisuje receipt regulaminu i polityki prywatności, potem przekierowuje', async () => {
    const { registerCandidate } = await import('@/lib/actions/auth');
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true }));
    expect(result).toEqual({ redirect: '/pl/potwierdzenie' });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'record_document_acceptance',
      expect.objectContaining({ p_profile_id: USER_ID, p_documents: ['terms', 'privacy'], p_locale: 'pl' }),
    );
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('błąd zapisu receiptu — rejestracja nieudana, niepotwierdzone konto cofnięte', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const { registerEmployer } = await import('@/lib/actions/auth');
    const result = await outcome(() => registerEmployer({ ...employer, agreeTerms: true }));
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it('istniejący adres (odpowiedź bez tożsamości) — neutralne przekierowanie, nic nie usuwa', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: USER_ID, email_confirmed_at: null, identities: [] } },
      error: null,
    });
    const { registerCandidate } = await import('@/lib/actions/auth');
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true }));
    expect(result).toEqual({ redirect: '/pl/potwierdzenie' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('konto już potwierdzone — błąd receiptu nie usuwa konta', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: USER_ID, email_confirmed_at: '2026-09-01T00:00:00Z', identities: [{ id: 'i1' }] } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const { registerCandidate } = await import('@/lib/actions/auth');
    const result = await outcome(() => registerCandidate({ ...candidate, agreeTerms: true }));
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
