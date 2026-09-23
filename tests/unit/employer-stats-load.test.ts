import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmployerOverview, getFunnelStats } from '@/lib/data/employer';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/sentry';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

type Result = { data?: unknown; count?: number | null; error: unknown };

/** Łańcuchowy builder PostgREST: każda metoda zwraca builder, `await` daje wynik z kolejki tabeli. */
function client(results: Record<string, Result[]>) {
  const queues = Object.fromEntries(Object.entries(results).map(([table, list]) => [table, [...list]]));
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: [], count: 0, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    }),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1', activeStatus: 'verified', activeName: 'Firma',
    activeRole: 'owner', companies: [],
  });
});

describe('employer overview tiles', () => {
  it('reports a failed count as an error, never as zero tiles', async () => {
    const error = { code: 'DATABASE_UNAVAILABLE' };
    client({
      jobs: [{ data: [{ id: 'job-1' }], error: null }, { count: null, error }],
    });
    expect(await getEmployerOverview()).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getEmployerOverview' });
  });

  it('reports a failed job id read as an error', async () => {
    const error = { code: 'TIMEOUT' };
    client({ jobs: [{ data: null, error }] });
    expect(await getEmployerOverview()).toEqual({ status: 'error' });
  });

  it('returns real zeros only after a successful read', async () => {
    client({
      jobs: [{ data: [], error: null }, { count: 0, error: null }],
      applications: [{ count: 0, error: null }],
      notifications: [{ count: 0, error: null }],
    });
    expect(await getEmployerOverview()).toEqual({
      status: 'ok',
      overview: { activeOffersCount: 0, newApplicationsCount: 0, matchedCandidatesCount: 0, messagesToAnswerCount: 0 },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('keeps successful counts', async () => {
    client({
      jobs: [{ data: [{ id: 'job-1' }], error: null }, { count: 3, error: null }],
      applications: [{ count: 5, error: null }],
      matches: [{ count: 7, error: null }],
      notifications: [{ count: 2, error: null }],
    });
    expect(await getEmployerOverview()).toEqual({
      status: 'ok',
      overview: { activeOffersCount: 3, newApplicationsCount: 5, matchedCandidatesCount: 7, messagesToAnswerCount: 2 },
    });
  });
});

describe('employer recruitment funnel', () => {
  it('reports a failed applications read as an error, never as an empty funnel', async () => {
    const error = { code: 'DATABASE_UNAVAILABLE' };
    client({
      jobs: [{ data: [{ views_count: 40 }], error: null }],
      applications: [{ data: null, error }],
    });
    expect(await getFunnelStats()).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getFunnelStats' });
  });

  it('reports a failed status history read as an error', async () => {
    client({
      jobs: [{ data: [{ views_count: 40 }], error: null }],
      applications: [{ data: [{ id: 'app-1' }], error: null }],
      application_status_history: [{ data: null, error: { code: 'URI_TOO_LONG' } }],
    });
    expect(await getFunnelStats()).toEqual({ status: 'error' });
  });

  it('returns an empty funnel only after a successful read', async () => {
    client({ jobs: [{ data: [], error: null }], applications: [{ data: [], error: null }] });
    expect(await getFunnelStats()).toEqual({
      status: 'ok',
      funnel: { views: 0, applications: 0, interviews: 0, hired: 0 },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('counts funnel stages from a successful read', async () => {
    client({
      jobs: [{ data: [{ views_count: 30 }, { views_count: '10' }], error: null }],
      applications: [{ data: [{ id: 'app-1' }, { id: 'app-2' }], error: null }],
      application_status_history: [{
        data: [
          { application_id: 'app-1', to_status: 'interview' },
          { application_id: 'app-1', to_status: 'hired' },
          { application_id: 'app-2', to_status: 'interview' },
        ],
        error: null,
      }],
    });
    expect(await getFunnelStats()).toEqual({
      status: 'ok',
      funnel: { views: 40, applications: 2, interviews: 2, hired: 1 },
    });
  });
});
