import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecentApplications } from '@/lib/data/employer';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/sentry';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

function client(rows: unknown[], error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn().mockReturnValue(query),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1', activeStatus: 'verified', activeName: 'Firma',
    activeRole: 'owner', companies: [],
  });
});

describe('recent employer applications', () => {
  it('exposes a failed read instead of showing an empty dashboard section', async () => {
    const error = { code: 'DATABASE_UNAVAILABLE' };
    const { query } = client([], error);
    expect(await getRecentApplications()).toEqual({ status: 'error' });
    expect(query.eq).toHaveBeenCalledWith('company_id', 'company-1');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.limit).toHaveBeenCalledWith(6);
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getRecentApplications' });
  });

  it('keeps a successful empty read distinct from an error', async () => {
    client([]);
    expect(await getRecentApplications()).toEqual({ status: 'ok', applications: [] });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('retains a real application and its status action data', async () => {
    client([{ id: 'app-1', status: 'reviewing', profiles: { first_name: 'Ada', last_name: 'Nowak' }, jobs: { title: 'Operator' } }]);
    expect(await getRecentApplications()).toEqual({ status: 'ok', applications: [
      { id: 'app-1', candidateName: 'Ada Nowak', jobTitle: 'Operator', status: 'reviewing' },
    ] });
  });
});
