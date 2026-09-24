// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bootstrap firmy w callbacku rejestracji (#28): jedno atomowe RPC `create_first_company`
 * (blokada profilu + ponowne sprawdzenie członkostwa w tej samej transakcji). Żadnego
 * odczytu członkostwa poza tą transakcją i żadnego wywołania `create_company_with_owner`,
 * które zawsze wstawia nową firmę.
 */

vi.mock('next-intl/server', () => ({ getLocale: async () => 'pl' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

const { bootstrapCompany } = await import('@/lib/actions/auth');

function client(
  rpcResult: { data: unknown; error: unknown },
  metadata: Record<string, unknown> = { company_name: '  Acme Logistics ' },
) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: '00000000-0000-4000-8000-0000000000aa', user_metadata: metadata } },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue(rpcResult),
    from: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bootstrapCompany — callback rejestracji bez wyścigu (#28)', () => {
  it('woła wyłącznie create_first_company, bez osobnego odczytu członkostwa', async () => {
    const supabase = client({ data: [{ company_id: 'c-1', created: true }], error: null });
    expect(await bootstrapCompany(supabase as never)).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('create_first_company', {
      p_name: 'Acme Logistics',
      p_slug: expect.stringMatching(/^acme-logistics-[a-z0-9]+$/),
      p_vat_number: null,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('istniejąca firma (drugi równoczesny callback) to sukces bez nowej firmy', async () => {
    const supabase = client({ data: [{ company_id: 'c-1', created: false }], error: null });
    expect(await bootstrapCompany(supabase as never)).toEqual({ ok: true });
    expect(supabase.rpc).not.toHaveBeenCalledWith('create_company_with_owner', expect.anything());
  });

  it('odmowa bazy (kandydat, nieaktywny profil, odebrany dostęp) → PERMISSION_DENIED', async () => {
    const supabase = client({
      data: null,
      error: { message: 'PERMISSION_DENIED: członkostwo w firmie nieaktywne' },
    });
    expect(await bootstrapCompany(supabase as never)).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('inny błąd RPC → INTERNAL (transakcja wycofana, ponowienie bezpieczne)', async () => {
    const supabase = client({ data: null, error: { message: 'connection reset' } });
    expect(await bootstrapCompany(supabase as never)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('brak nazwy firmy w metadanych → VALIDATION_FAILED bez wywołania RPC', async () => {
    const supabase = client({ data: null, error: null }, {});
    expect(await bootstrapCompany(supabase as never)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
