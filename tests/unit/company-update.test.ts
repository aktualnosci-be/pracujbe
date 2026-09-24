import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompany } from '@/lib/actions/company';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

function client(data: unknown, error: unknown = null) {
  const query = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data, error }),
  };
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn().mockReturnValue(query),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeRole: 'owner',
  } as never);
});

describe('company update authorization', () => {
  it('rejects a regular member before writing', async () => {
    const { supabase } = client([{ id: 'company-1' }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await updateCompany({ name: 'Acme' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does not claim success when RLS updates zero rows', async () => {
    const { query } = client([]);
    expect(await updateCompany({ name: 'Acme' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(query.select).toHaveBeenCalledWith('id, status');
  });

  it('accepts one confirmed update by an owner', async () => {
    client([{ id: 'company-1' }]);
    expect(await updateCompany({ name: 'Acme' })).toEqual({ ok: true });
  });

  it('informuje, gdy zmiana danych zweryfikowanej firmy wraca do weryfikacji', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'owner',
      activeStatus: 'verified',
    } as never);
    client([{ id: 'company-1', status: 'pending' }]);
    expect(await updateCompany({ name: 'Acme Nowa' })).toEqual({
      ok: true,
      reverificationRequired: true,
    });
  });

  it('bez zmiany statusu nie zgłasza ponownej weryfikacji', async () => {
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'owner',
      activeStatus: 'verified',
    } as never);
    client([{ id: 'company-1', status: 'verified' }]);
    expect(await updateCompany({ name: 'Acme' })).toEqual({ ok: true });
  });
});
