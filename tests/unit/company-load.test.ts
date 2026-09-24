import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyCompany } from '@/lib/data/company';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/sentry';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

function client(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
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
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeRole: 'owner',
  } as never);
});

describe('company read state', () => {
  it('keeps database failures distinct from a missing company', async () => {
    const failure = { code: 'DATABASE_UNAVAILABLE' };
    const { query } = client(null, failure);
    expect(await getMyCompany()).toEqual({ status: 'error' });
    expect(query.eq).toHaveBeenCalledWith('company_id', 'company-1');
    expect(captureError).toHaveBeenCalledWith(failure, {
      area: 'company.getMyCompany',
    });
  });

  it('allows creation only when active membership is absent', async () => {
    const { supabase } = client([]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: null,
      activeRole: 'member',
    } as never);
    expect(await getMyCompany()).toEqual({ status: 'ok', company: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns the company after a successful RLS read', async () => {
    client([
      {
        companies: {
          id: 'company-1',
          name: 'Acme',
          slug: 'acme',
          status: 'pending',
          vat_number: null,
          verified_at: null,
        },
      },
    ]);
    expect(await getMyCompany()).toEqual({
      status: 'ok',
      company: {
        id: 'company-1',
        name: 'Acme',
        slug: 'acme',
        status: 'pending',
        vatNumber: null,
        verifiedAt: null,
        statusReason: null,
        canEdit: true,
      },
    });
  });

  it('does not treat missing auth data as a company-free account', async () => {
    const { supabase } = client([]);
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    } as never);
    expect(await getMyCompany()).toEqual({ status: 'error' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does not treat a failed membership lookup as no company', async () => {
    const { supabase } = client([]);
    vi.mocked(getActiveCompany).mockRejectedValue(
      new Error('membership read failed'),
    );
    expect(await getMyCompany()).toEqual({ status: 'error' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does not allow a regular member to edit company data', async () => {
    client([{ companies: { id: 'company-1', name: 'Acme' } }]);
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1',
      activeRole: 'member',
    } as never);
    expect(await getMyCompany()).toMatchObject({
      status: 'ok',
      company: { canEdit: false },
    });
  });
});
