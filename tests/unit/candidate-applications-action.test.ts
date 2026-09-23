import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMoreApplications } from '@/lib/actions/candidate-applications';
import { getMyApplicationsPage } from '@/lib/data/candidate';

vi.mock('@/lib/data/candidate', () => ({ getMyApplicationsPage: vi.fn() }));

const cursor = {
  submittedAt: '2026-09-20T09:00:00+00:00',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010',
};

beforeEach(() => vi.clearAllMocks());

describe('loadMoreApplications', () => {
  it('accepts a valid cursor and reads under the server session', async () => {
    vi.mocked(getMyApplicationsPage).mockResolvedValue({ items: [], nextCursor: null });
    expect(await loadMoreApplications('pl', cursor)).toEqual({ status: 'ready', page: { items: [], nextCursor: null } });
    expect(getMyApplicationsPage).toHaveBeenCalledWith('pl', cursor);
  });

  it.each([
    ['unsupported locale', 'de', cursor],
    ['injected filter', 'pl', { ...cursor, id: 'a,or(candidate_id.neq.own)' }],
    ['invalid date', 'pl', { ...cursor, submittedAt: 'yesterday' }],
    ['quoted date injection', 'pl', { ...cursor, submittedAt: '2026-09-20T09:00:00+00:00"),candidate_id.neq.own' }],
  ])('rejects %s before querying', async (_reason, locale, value) => {
    expect(await loadMoreApplications(locale, value)).toEqual({ status: 'error' });
    expect(getMyApplicationsPage).not.toHaveBeenCalled();
  });

  it('hides read failures from the client', async () => {
    vi.mocked(getMyApplicationsPage).mockRejectedValue(new Error('database details'));
    expect(await loadMoreApplications('pl', cursor)).toEqual({ status: 'error' });
  });
});
