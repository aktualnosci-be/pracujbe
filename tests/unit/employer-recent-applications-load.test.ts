import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecentApplications } from '@/lib/data/employer';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/sentry';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';

function db(rows: unknown[], error: unknown = null) {
  fakeDb.rows('employer.recent-applications', () => {
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

describe('recent employer applications', () => {
  it('exposes a failed read instead of showing an empty dashboard section', async () => {
    const error = pgError('XX000', 'DATABASE_UNAVAILABLE');
    db([], error);
    expect(await getRecentApplications()).toEqual({ status: 'error' });
    const [call] = fakeDb.callsTo('employer.recent-applications');
    expect(call?.values).toEqual(['company-1']);
    expect(call?.text).toContain('a.deleted_at IS NULL');
    expect(call?.text).toContain('LIMIT 6');
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getRecentApplications' });
  });

  it('keeps a successful empty read distinct from an error', async () => {
    db([]);
    expect(await getRecentApplications()).toEqual({ status: 'ok', applications: [] });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('retains a real application and its status action data', async () => {
    db([{ id: 'app-1', status: 'reviewing', candidate_id: 'cand-1', profiles: { first_name: 'Ada', last_name: 'Nowak' }, jobs: { title: 'Operator' } }]);
    expect(await getRecentApplications()).toEqual({ status: 'ok', applications: [
      { id: 'app-1', candidateName: 'Ada Nowak', jobTitle: 'Operator', status: 'reviewing' },
    ] });
  });

  it('keeps a missing session empty without querying another account', async () => {
    db([]);
    fakeSession.identity = null;
    expect(await getRecentApplications()).toEqual({ status: 'ok', applications: [] });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
