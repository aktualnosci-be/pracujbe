import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPLOYER_APPLICATIONS_PAGE_SIZE, getEmployerApplicationsPage } from '@/lib/data/employer';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/error-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function db(rows: unknown[], error: unknown = null) {
  fakeDb.rows('employer.applications-page', () => {
    if (error) throw error;
    return rows;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1', activeStatus: 'verified', activeName: 'Firma',
    activeRole: 'owner', companies: [],
  });
});

describe('employer applications page data', () => {
  it('returns a separate error state instead of an empty list on read failure', async () => {
    const error = pgError('XX000', 'DATABASE_UNAVAILABLE');
    db([], error);
    expect(await getEmployerApplicationsPage(1)).toEqual({ status: 'error' });
    expect(fakeDb.callsTo('employer.applications-page')[0]?.values[0]).toBe('company-1');
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getEmployerApplicationsPage' });
  });

  it('loads a bounded, stable page and uses one extra row to expose older results', async () => {
    const rows = Array.from({ length: EMPLOYER_APPLICATIONS_PAGE_SIZE + 1 }, (_, index) => ({
      id: `app-${index}`, status: 'submitted', candidate_id: `cand-${index}`,
      profiles: { first_name: 'Ada', last_name: 'Nowak' },
      jobs: { title: 'Operator' },
    }));
    db(rows);
    const result = await getEmployerApplicationsPage(2);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.applications).toHaveLength(EMPLOYER_APPLICATIONS_PAGE_SIZE);
    expect(result.applications[0]).toEqual({ id: 'app-0', candidateName: 'Ada Nowak', jobTitle: 'Operator', status: 'submitted' });
    expect(result.hasMore).toBe(true);
    expect(result.isDemo).toBe(false);
    const [call] = fakeDb.callsTo('employer.applications-page');
    // LIMIT = strona + 1, OFFSET = (strona - 1) × 12.
    expect(call?.values).toEqual(['company-1', 13, 12]);
    expect(call?.text).toContain('ORDER BY a.submitted_at DESC, a.id DESC');
    expect(call?.text).toContain('a.deleted_at IS NULL');
    expect(call?.as).toBe(USER);
  });

  it('shows a guest application with its snapshot name (#98)', async () => {
    db([{ id: 'app-g', status: 'submitted', candidate_id: null, guest_name: 'Jan Gość', profiles: null, jobs: { title: 'Operator' } }]);
    const result = await getEmployerApplicationsPage(1);
    expect(result.status === 'ok' && result.applications[0]).toEqual({
      id: 'app-g', candidateName: 'Jan Gość', jobTitle: 'Operator', status: 'submitted', isGuest: true,
    });
  });

  it('shows an actual empty state after a successful read', async () => {
    db([]);
    expect(await getEmployerApplicationsPage(1)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: false });
  });

  it('does not read applications without an active company', async () => {
    db([]);
    vi.mocked(getActiveCompany).mockResolvedValueOnce({
      activeId: null, activeStatus: 'unverified', activeName: '', activeRole: 'member', companies: [],
    });
    expect(await getEmployerApplicationsPage(1)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: false });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects unbounded page numbers before accessing data', async () => {
    db([]);
    expect(await getEmployerApplicationsPage(1001)).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
    expect(getActiveCompany).not.toHaveBeenCalled();
  });

  it('marks synthetic data clearly and does not spill it into later pages', async () => {
    fakeSession.configured = false;
    const first = await getEmployerApplicationsPage(1);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.isDemo).toBe(true);
    expect(first.applications.length).toBeGreaterThan(0);
    expect(await getEmployerApplicationsPage(2)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
