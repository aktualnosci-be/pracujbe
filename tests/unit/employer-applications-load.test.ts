import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPLOYER_APPLICATIONS_PAGE_SIZE, getEmployerApplicationsPage } from '@/lib/data/employer';
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
    range: vi.fn().mockResolvedValue({ data: rows, error }),
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

describe('employer applications page data', () => {
  it('returns a separate error state instead of an empty list on read failure', async () => {
    const error = { code: 'DATABASE_UNAVAILABLE' };
    const { query } = client([], error);
    expect(await getEmployerApplicationsPage(1)).toEqual({ status: 'error' });
    expect(query.eq).toHaveBeenCalledWith('company_id', 'company-1');
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getEmployerApplicationsPage' });
  });

  it('loads a bounded, stable page and uses one extra row to expose older results', async () => {
    const rows = Array.from({ length: EMPLOYER_APPLICATIONS_PAGE_SIZE + 1 }, (_, index) => ({
      id: `app-${index}`, status: 'submitted',
      profiles: { first_name: 'Ada', last_name: 'Nowak' },
      jobs: { title: 'Operator' },
    }));
    const { query } = client(rows);
    const result = await getEmployerApplicationsPage(2);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.applications).toHaveLength(EMPLOYER_APPLICATIONS_PAGE_SIZE);
    expect(result.applications[0]).toEqual({ id: 'app-0', candidateName: 'Ada Nowak', jobTitle: 'Operator', status: 'submitted' });
    expect(result.hasMore).toBe(true);
    expect(result.isDemo).toBe(false);
    expect(query.range).toHaveBeenCalledWith(12, 24);
    expect(query.order).toHaveBeenCalledWith('submitted_at', { ascending: false });
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false });
  });

  it('shows an actual empty state after a successful read', async () => {
    client([]);
    expect(await getEmployerApplicationsPage(1)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: false });
  });

  it('does not read applications without an active company', async () => {
    const { supabase } = client([]);
    vi.mocked(getActiveCompany).mockResolvedValueOnce({
      activeId: null, activeStatus: 'unverified', activeName: '', activeRole: 'member', companies: [],
    });
    expect(await getEmployerApplicationsPage(1)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects unbounded page numbers before accessing data', async () => {
    const { supabase } = client([]);
    expect(await getEmployerApplicationsPage(1001)).toEqual({ status: 'error' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('marks synthetic data clearly and does not spill it into later pages', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const first = await getEmployerApplicationsPage(1);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.isDemo).toBe(true);
    expect(first.applications.length).toBeGreaterThan(0);
    expect(await getEmployerApplicationsPage(2)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: true });
  });
});
