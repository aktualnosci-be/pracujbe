import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmployerOverview, getFunnelStats, getJobFunnel } from '@/lib/data/employer';
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
const builders: { table: string; builder: Record<string, ReturnType<typeof vi.fn> | unknown> }[] = [];

/** Wynik RPC `get_company_job_funnel` (lejek ofert, #99); domyślnie pusty odczyt. */
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };

function client(results: Record<string, Result[]>) {
  builders.length = 0;
  const queues = Object.fromEntries(Object.entries(results).map(([table, list]) => [table, [...list]]));
  const supabase = {
    rpc: vi.fn(async () => rpcResult),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: [], count: 0, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gte', 'or']) {
        builder[method] = vi.fn(() => builder);
      }
      builders.push({ table, builder });
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    }),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.resetAllMocks();
  rpcResult = { data: [], error: null };
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

  it('does not count an active job past expires_at as active (#72)', async () => {
    client({ jobs: [{ data: [], error: null }, { count: 0, error: null }] });
    await getEmployerOverview();
    const activeCount = builders.filter((b) => b.table === 'jobs')[1]!.builder;
    expect(activeCount.eq).toHaveBeenCalledWith('status', 'active');
    expect(activeCount.or).toHaveBeenCalledWith(expect.stringMatching(/^expires_at\.is\.null,expires_at\.gt\.\d{4}-/));
  });
});

describe('employer recruitment funnel', () => {
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const SINCE = '2026-08-24T12:00:00.000Z';

  it('reports a failed applications count as an error, never as an empty funnel', async () => {
    const error = { code: 'DATABASE_UNAVAILABLE' };
    client({ applications: [{ count: null, error }] });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getFunnelStats' });
  });

  it('reports a failed stage count as an error', async () => {
    client({
      applications: [
        { count: 2, error: null },
        { count: null, error: { code: 'TIMEOUT' } },
        { count: 0, error: null },
      ],
    });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'error' });
  });

  it('returns an empty funnel only after a successful read, with zero views from the job funnel (#99)', async () => {
    client({ applications: [{ count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }] });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: 0, applications: 0, interviews: 0, hired: 0 },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('counts funnel stages in the database for the last 30 days only (#302)', async () => {
    rpcResult = {
      data: [
        { job_id: 'job-1', detail_views: 40, search_appearances: 90, apply_started: 9, applications_submitted: 3 },
        { job_id: 'job-2', detail_views: '15', search_appearances: 0, apply_started: 0, applications_submitted: 0 },
      ],
      error: null,
    };
    const supabase = client({
      applications: [{ count: 12, error: null }, { count: 5, error: null }, { count: 2, error: null }],
    });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: 55, applications: 12, interviews: 5, hired: 2 },
    });
    // Wyświetlenia = serwerowy agregat (#99) za 30 dni kalendarzowych w Brukseli, nie jobs.views_count.
    expect(supabase.rpc).toHaveBeenCalledWith('get_company_job_funnel', {
      p_company_id: 'company-1', p_from: '2026-08-25', p_to: '2026-09-23',
    });

    // Bez sumy views_count i bez pobierania wierszy/listy UUID.
    expect(supabase.from).not.toHaveBeenCalledWith('jobs');
    expect(supabase.from).not.toHaveBeenCalledWith('application_status_history');
    expect(builders).toHaveLength(3);
    for (const { builder } of builders) {
      const b = builder as Record<string, ReturnType<typeof vi.fn>>;
      expect(b.select!.mock.calls[0]![1]).toEqual({ count: 'exact', head: true });
      expect(b.eq).toHaveBeenCalledWith('company_id', 'company-1');
      expect(b.is).toHaveBeenCalledWith('deleted_at', null);
      expect(b.gte).toHaveBeenCalledWith('submitted_at', SINCE);
    }
    const [, interviews, hired] = builders.map(({ builder }) => builder as Record<string, ReturnType<typeof vi.fn>>);
    expect(interviews!.select!.mock.calls[0]![0]).toContain('application_status_history!inner');
    expect(interviews!.in).toHaveBeenCalledWith(
      'application_status_history.to_status',
      ['interview', 'offer_sent', 'offer_accepted', 'offer_declined', 'hired'],
    );
    expect(hired!.eq).toHaveBeenCalledWith('application_status_history.to_status', 'hired');
  });
});

describe('job funnel views in the recruitment funnel (#99)', () => {
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const counts = [{ count: 4, error: null }, { count: 1, error: null }, { count: 0, error: null }];

  it('shows “no data” views for a member without recruiter rights, not zero', async () => {
    rpcResult = { data: null, error: { code: '42501' } };
    client({ applications: counts });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: null, applications: 4, interviews: 1, hired: 0 },
    });
  });

  it('reports a failed job funnel read as an error', async () => {
    const error = { code: 'TIMEOUT' };
    rpcResult = { data: null, error };
    client({ applications: counts });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getFunnelStats' });
  });
});

describe('job funnel per offer (#99)', () => {
  const NOW = new Date('2026-09-23T22:30:00.000Z'); // 00:30 w Brukseli — już 24 września

  it('reads the range in Brussels calendar days and sums the metrics', async () => {
    rpcResult = {
      data: [
        { job_id: 'job-1', title: 'Magazynier', slug: 'magazynier', status: 'active',
          search_appearances: '120', detail_views: 30, apply_started: 6, applications_submitted: 2 },
        { job_id: 'job-2', title: null, slug: null, status: 'closed',
          search_appearances: 5, detail_views: 1, apply_started: 0, applications_submitted: 1 },
      ],
      error: null,
    };
    const supabase = client({});
    const load = await getJobFunnel(7, NOW);
    expect(supabase.rpc).toHaveBeenCalledWith('get_company_job_funnel', {
      p_company_id: 'company-1', p_from: '2026-09-18', p_to: '2026-09-24',
    });
    expect(load).toEqual({
      status: 'ok',
      range: { days: 7, from: '2026-09-18', to: '2026-09-24' },
      totals: { searchAppearances: 125, detailViews: 31, applyStarted: 6, applicationsSubmitted: 3 },
      jobs: [
        { jobId: 'job-1', title: 'Magazynier', slug: 'magazynier', status: 'active',
          searchAppearances: 120, detailViews: 30, applyStarted: 6, applicationsSubmitted: 2 },
        { jobId: 'job-2', title: '', slug: '', status: 'closed',
          searchAppearances: 5, detailViews: 1, applyStarted: 0, applicationsSubmitted: 1 },
      ],
    });
  });

  it('separates missing rights from a failed read', async () => {
    rpcResult = { data: null, error: { code: '42501' } };
    client({});
    expect((await getJobFunnel(30, NOW)).status).toBe('denied');

    rpcResult = { data: null, error: { code: 'TIMEOUT' } };
    client({});
    expect((await getJobFunnel(30, NOW)).status).toBe('error');
    expect(captureError).toHaveBeenCalledWith({ code: 'TIMEOUT' }, { area: 'employer.getJobFunnel' });
  });
});
