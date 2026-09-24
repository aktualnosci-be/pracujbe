import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompany, requestCompanyReverification } from '@/lib/actions/company';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

function client(rpcResult: { data: unknown; error: unknown }) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    rpc: vi.fn().mockResolvedValue(rpcResult),
    from: vi.fn(),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeRole: 'owner',
    activeStatus: 'rejected',
  } as never);
});

describe('createCompany — firma i VAT w jednej transakcji (#368, #365)', () => {
  it('przekazuje VAT do RPC zamiast osobnego UPDATE', async () => {
    const supabase = client({ data: [{ company_id: 'company-9', created: true }], error: null });
    expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0123456789' })).toEqual({
      ok: true,
      id: 'company-9',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_first_company',
      expect.objectContaining({ p_name: 'Acme Logistics', p_vat_number: 'BE0123456789' }),
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('nieudany zapis (np. VAT) nie daje sukcesu', async () => {
    client({ data: null, error: { message: 'new row violates check constraint "companies_vat_len"' } });
    expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0123456789' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('ponowne kliknięcie zwraca istniejącą firmę bez duplikatu', async () => {
    client({ data: [{ company_id: 'company-9', created: false }], error: null });
    expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: true, id: 'company-9' });
  });

  it('pusta odpowiedź RPC to błąd, nie sukces', async () => {
    client({ data: [], error: null });
    expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('requestCompanyReverification (#400)', () => {
  it('zwykły member nie wywołuje RPC', async () => {
    const supabase = client({ data: null, error: null });
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await requestCompanyReverification()).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('zgłasza aktywną firmę owner-a', async () => {
    const supabase = client({ data: null, error: null });
    expect(await requestCompanyReverification()).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith('request_company_reverification', {
      p_company_id: 'company-1',
    });
  });

  it('stan inny niż odrzucony mapuje na INVALID_TRANSITION', async () => {
    client({ data: null, error: { message: 'COMPANY_STATUS_INVALID' } });
    expect(await requestCompanyReverification()).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('limit prób zatrzymuje przed zapisem', async () => {
    const supabase = client({ data: null, error: null });
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await requestCompanyReverification()).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
