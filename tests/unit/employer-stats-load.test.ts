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
const builders: { table: string; builder: Record<string, ReturnType<typeof vi.fn> | unknown> }[] = [];

function client(results: Record<string, Result[]>) {
  builders.length = 0;
  const queues = Object.fromEntries(Object.entries(results).map(([table, list]) => [table, [...list]]));
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    from: vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: [], count: 0, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gte']) {
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

  it('returns an empty funnel only after a successful read, with views as “no data”', async () => {
    client({ applications: [{ count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }] });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: null, applications: 0, interviews: 0, hired: 0 },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('counts funnel stages in the database for the last 30 days only (#302)', async () => {
    const supabase = client({
      applications: [{ count: 12, error: null }, { count: 5, error: null }, { count: 2, error: null }],
    });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: null, applications: 12, interviews: 5, hired: 2 },
    });

    // Bez sumy views_count (brak mechanizmu zliczania) i bez pobierania wierszy/listy UUID.
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
