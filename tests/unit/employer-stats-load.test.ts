import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmployerOverview, getFunnelStats, getJobFunnel } from '@/lib/data/employer';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

/** Licznik: liczba albo błąd bazy (rzucany z handlera). */
type Count = number | Error;

function count(name: string, value: Count) {
  fakeDb.count(name, () => {
    if (value instanceof Error) throw value;
    return value;
  });
}

function overview(values: { active?: Count; apps?: Count; matches?: Count; messages?: Count }) {
  count('employer.overview-active-jobs', values.active ?? 0);
  count('employer.overview-new-applications', values.apps ?? 0);
  count('employer.overview-matched-candidates', values.matches ?? 0);
  count('employer.overview-awaiting-reply', values.messages ?? 0);
}

/** Lejek: trzy liczniki kohorty + RPC lejka ofert (#99). */
function funnel(values: { apps?: Count; interviews?: Count; hired?: Count; rpc?: unknown[] | Error }) {
  count('employer.funnel-applications', values.apps ?? 0);
  count('employer.funnel-interviews', values.interviews ?? 0);
  count('employer.funnel-hired', values.hired ?? 0);
  fakeDb.rpc('get_company_job_funnel', () => {
    if (values.rpc instanceof Error) throw values.rpc;
    return values.rpc ?? [];
  });
}

/** Aktywna firma sesji z daną rolą i statusem weryfikacji. */
function activeAs(role: string, status = 'verified') {
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1', activeStatus: status, activeName: 'Firma',
    activeRole: role, companies: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  activeAs('owner');
});

describe('employer overview tiles', () => {
  it.each(['active', 'apps', 'matches', 'messages'] as const)(
    'reports a failed %s count as an error, never as zero tiles', async (field) => {
      const error = pgError('XX000', 'DATABASE_UNAVAILABLE');
      overview({ active: 1, apps: 1, matches: 1, messages: 1, [field]: error });
      expect(await getEmployerOverview()).toEqual({ status: 'error' });
      expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getEmployerOverview' });
    },
  );

  it('returns real zeros only after a successful read', async () => {
    overview({});
    expect(await getEmployerOverview()).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 0, newApplicationsCount: 0, matchedCandidatesCount: 0, messagesToAnswerCount: 0,
        recruiterAccess: true, companyVerified: true,
      },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('keeps every counter scoped to the ACTIVE company, read under the session user', async () => {
    overview({ active: 3, apps: 5, matches: 7, messages: 2 });
    expect(await getEmployerOverview()).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 3, newApplicationsCount: 5, matchedCandidatesCount: 7, messagesToAnswerCount: 2,
        recruiterAccess: true, companyVerified: true,
      },
    });
    for (const name of [
      'employer.overview-active-jobs', 'employer.overview-new-applications',
      'employer.overview-matched-candidates', 'employer.overview-awaiting-reply',
    ]) {
      expect(fakeDb.callsTo(name)[0]?.values).toEqual(['company-1']);
    }
    // Wiadomości do odpowiedzi liczone per FIRMA (rozmowy), nie z powiadomień użytkownika —
    // dawny licznik obejmował też inne firmy użytkownika.
    expect(fakeDb.callsTo('employer.overview-unread-messages')).toHaveLength(0);
    expect(new Set(fakeDb.calls.map((c) => c.as))).toEqual(new Set([USER]));
  });

  it('P1-14: matched = DISTINCT candidates (one candidate matched to many offers counts once)', async () => {
    overview({});
    await getEmployerOverview();
    const text = fakeDb.callsTo('employer.overview-matched-candidates')[0]!.text;
    expect(text).toContain('SELECT DISTINCT m.candidate_id');
    expect(text).toContain('j.deleted_at IS NULL');
  });

  it('P1-14: awaiting reply = last message from outside the company, per company conversation', async () => {
    overview({});
    await getEmployerOverview();
    const text = fakeDb.callsTo('employer.overview-awaiting-reply')[0]!.text;
    expect(text).toContain('c.company_id = $1');
    expect(text).toContain('ORDER BY m.created_at DESC, m.id DESC');
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM public.company_members cm');
  });

  it('P1-14: a plain member gets "no data" (null), not the zeros RLS would return', async () => {
    activeAs('member');
    overview({ active: 3, apps: 0, matches: 0, messages: 0 });
    expect(await getEmployerOverview()).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 3, newApplicationsCount: null, matchedCandidatesCount: null, messagesToAnswerCount: null,
        recruiterAccess: false, companyVerified: true,
      },
    });
    // Liczniki rekrutacyjne w ogóle nie są pytane (bez wyników udających brak aktywności).
    expect(fakeDb.callsTo('employer.overview-new-applications')).toHaveLength(0);
    expect(fakeDb.callsTo('employer.overview-matched-candidates')).toHaveLength(0);
    expect(fakeDb.callsTo('employer.overview-awaiting-reply')).toHaveLength(0);
  });

  it.each(['owner', 'admin', 'recruiter'])('negative control: %s (recruiter+) gets real counts', async (role) => {
    activeAs(role);
    overview({ apps: 4, matches: 2, messages: 1 });
    const result = await getEmployerOverview();
    expect(result).toMatchObject({
      status: 'ok',
      overview: { newApplicationsCount: 4, matchedCandidatesCount: 2, messagesToAnswerCount: 1, recruiterAccess: true },
    });
  });

  it('P1-14: unverified company — matched candidates wait for verification (null), the rest is real', async () => {
    activeAs('owner', 'pending');
    overview({ apps: 4, matches: 9, messages: 1 });
    expect(await getEmployerOverview()).toMatchObject({
      status: 'ok',
      overview: { newApplicationsCount: 4, matchedCandidatesCount: null, messagesToAnswerCount: 1, companyVerified: false },
    });
    expect(fakeDb.callsTo('employer.overview-matched-candidates')).toHaveLength(0);
  });

  it('does not count an active job past expires_at as active (#72)', async () => {
    overview({});
    await getEmployerOverview();
    const text = fakeDb.callsTo('employer.overview-active-jobs')[0]!.text;
    expect(text).toContain("status = 'active'");
    expect(text).toContain('(expires_at IS NULL OR expires_at > now())');
  });
});

describe('employer recruitment funnel', () => {
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const SINCE = '2026-08-24T12:00:00.000Z';

  it('reports a failed applications count as an error, never as an empty funnel', async () => {
    const error = pgError('XX000', 'DATABASE_UNAVAILABLE');
    funnel({ apps: error });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getFunnelStats' });
  });

  it('reports a failed stage count as an error', async () => {
    funnel({ apps: 2, interviews: pgError('57014', 'TIMEOUT') });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'error' });
  });

  it('returns an empty funnel only after a successful read, with zero views from the job funnel (#99)', async () => {
    funnel({});
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: 0, applications: 0, interviews: 0, hired: 0 },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('counts funnel stages in the database for the last 30 days only (#302)', async () => {
    funnel({
      apps: 12,
      interviews: 5,
      hired: 2,
      rpc: [
        { job_id: 'job-1', detail_views: 40, search_appearances: 90, apply_started: 9, applications_submitted: 3 },
        { job_id: 'job-2', detail_views: '15', search_appearances: 0, apply_started: 0, applications_submitted: 0 },
      ],
    });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: 55, applications: 12, interviews: 5, hired: 2 },
    });
    // Wyświetlenia = serwerowy agregat (#99) za 30 dni kalendarzowych w Brukseli, nie jobs.views_count.
    expect(fakeDb.callsTo('get_company_job_funnel')[0]?.args).toEqual({
      p_company_id: 'company-1', p_from: '2026-08-25', p_to: '2026-09-23',
    });

    const [apps] = fakeDb.callsTo('employer.funnel-applications');
    const [interviews] = fakeDb.callsTo('employer.funnel-interviews');
    const [hired] = fakeDb.callsTo('employer.funnel-hired');
    for (const call of [apps, interviews, hired]) {
      expect(call?.kind).toBe('count');
      expect(call?.values.slice(0, 2)).toEqual(['company-1', SINCE]);
      expect(call?.text).toContain('a.deleted_at IS NULL AND a.submitted_at >= $2::timestamptz');
    }
    expect(apps?.text).not.toContain('application_status_history');
    // Każda aplikacja liczona raz: EXISTS na historii statusów.
    expect(interviews?.text).toContain('EXISTS (SELECT 1 FROM public.application_status_history h');
    expect(interviews?.values[2]).toEqual(['interview', 'offer_sent', 'offer_accepted', 'offer_declined', 'hired']);
    expect(hired?.values[2]).toEqual(['hired']);
    // Bez sumy views_count i bez pobierania wierszy/listy UUID.
    expect(fakeDb.calls.filter((c) => c.kind === 'rows')).toHaveLength(0);
  });
});

describe('job funnel views in the recruitment funnel (#99)', () => {
  const NOW = new Date('2026-09-23T12:00:00.000Z');

  it('shows “no data” views for a member without recruiter rights, not zero', async () => {
    funnel({ apps: 4, interviews: 1, hired: 0, rpc: pgError('42501', 'PERMISSION_DENIED') });
    expect(await getFunnelStats(NOW)).toEqual({
      status: 'ok',
      funnel: { views: null, applications: 4, interviews: 1, hired: 0 },
    });
  });

  it('P1-14: a plain member gets an explicit "denied" funnel, no queries run', async () => {
    activeAs('member');
    funnel({ apps: 0, interviews: 0, hired: 0, rpc: [] });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'denied' });
    expect(fakeDb.calls).toHaveLength(0);
    // Kontrola ujemna: recruiter czyta ten sam lejek.
    activeAs('recruiter');
    expect(await getFunnelStats(NOW)).toMatchObject({ status: 'ok' });
  });

  it('reports a failed job funnel read as an error', async () => {
    const error = pgError('57014', 'TIMEOUT');
    funnel({ apps: 4, interviews: 1, rpc: error });
    expect(await getFunnelStats(NOW)).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getFunnelStats' });
  });
});

describe('job funnel per offer (#99)', () => {
  const NOW = new Date('2026-09-23T22:30:00.000Z'); // 00:30 w Brukseli — już 24 września

  it('reads the range in Brussels calendar days and sums the metrics', async () => {
    funnel({
      rpc: [
        { job_id: 'job-1', title: 'Magazynier', slug: 'magazynier', status: 'active',
          search_appearances: '120', detail_views: 30, apply_started: 6, applications_submitted: 2 },
        { job_id: 'job-2', title: null, slug: null, status: 'closed',
          search_appearances: 5, detail_views: 1, apply_started: 0, applications_submitted: 1 },
      ],
    });
    const load = await getJobFunnel(7, NOW);
    expect(fakeDb.callsTo('get_company_job_funnel')[0]?.args).toEqual({
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
    funnel({ rpc: pgError('42501', 'PERMISSION_DENIED') });
    expect((await getJobFunnel(30, NOW)).status).toBe('denied');

    resetFakeDb({ id: USER, role: 'employer' });
    const error = pgError('57014', 'TIMEOUT');
    funnel({ rpc: error });
    expect((await getJobFunnel(30, NOW)).status).toBe('error');
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getJobFunnel' });
  });
});
