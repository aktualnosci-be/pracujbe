import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalIdentity } from '@/lib/auth/session';
import { getPublicSavedJobs } from '@/lib/actions/public-saved-jobs';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => {
  const fake = (await import('../helpers/fake-db')).fakePortal();
  return { ...fake, getPortalIdentity: vi.fn(fake.getPortalIdentity) };
});

const { getPortalIdentity } = await import('@/lib/db/portal');
const id = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function db({ identity = { id: userId, role: 'candidate' } as PortalIdentity | null, readError = false } = {}) {
  resetFakeDb(identity);
  fakeDb.rows('candidate.public-saved-jobs', () => {
    if (readError) throw pgError('XX000', 'read failed');
    return [{ job_id: id }];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
});

describe('Public saved jobs batch action', () => {
  it('reads one bounded deduplicated collection under authenticated ownership', async () => {
    db();
    expect(await getPublicSavedJobs([id, id])).toEqual({
      status: 'candidate',
      savedIds: [id],
    });
    const calls = fakeDb.callsTo('candidate.public-saved-jobs');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ as: userId, values: [userId, [id]] });
    expect(calls[0]!.text).toContain('candidate_id = $1 AND job_id = ANY($2::uuid[])');
    expect(calls[0]!.text).toContain('LIMIT 100');
  });
  it('does not read saved rows for anonymous or employer accounts', async () => {
    db({ identity: null });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'anonymous' });
    expect(fakeDb.calls).toHaveLength(0);
    db({ identity: { id: userId, role: 'employer' } });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'unavailable' });
    expect(fakeDb.calls).toHaveLength(0);
  });
  it('separates failed reads from an empty collection', async () => {
    db({ readError: true });
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'error' });
  });
  it('fails closed on session read failure', async () => {
    db();
    vi.mocked(getPortalIdentity).mockRejectedValueOnce(new Error('auth backend unavailable'));
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });
  it('rejects invalid and oversized input before connecting', async () => {
    db();
    expect(await getPublicSavedJobs(['invalid'])).toEqual({
      status: 'unavailable',
    });
    expect(await getPublicSavedJobs(Array(101).fill(id))).toEqual({
      status: 'unavailable',
    });
    expect(getPortalIdentity).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });
  it('does not simulate saving when the service is unconfigured', async () => {
    db();
    fakeSession.configured = false;
    expect(await getPublicSavedJobs([id])).toEqual({ status: 'unavailable' });
    expect(getPortalIdentity).not.toHaveBeenCalled();
  });
});
