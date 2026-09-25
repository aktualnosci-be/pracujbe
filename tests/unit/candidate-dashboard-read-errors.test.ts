import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCandidateOverview, getLatestMessages, getMyApplicationsPreview } from '@/lib/data/candidate';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const CANDIDATE = '11111111-1111-4111-8111-111111111111';

/**
 * Odczyty pulpitu, które test kolejno psuje (#244). Liczniki są sekcjami jednej transakcji
 * (`attempt`, SAVEPOINT) — błąd jednej nie przerywa pozostałych.
 */
type Read = 'newJobs' | 'activeApplications' | 'unreadConversations' | 'applicationList' | 'latestMessages';

const readError = pgError('XX000', 'read-failed');

function db(failed: Read | null, empty = false) {
  resetFakeDb({ id: CANDIDATE, role: 'candidate' });
  const result = (read: Read, value: unknown) => () => {
    if (failed === read) throw readError;
    return value;
  };
  fakeDb
    .rpc('get_public_jobs_count', result('newJobs', 12))
    .count('candidate.active-applications', result('activeApplications', 4))
    .count('candidate.unread-conversations', result('unreadConversations', empty ? 0 : 1))
    .rows('candidate.applications-page', result('applicationList', empty ? [] : [
      { id: 'app-1', job_id: 'job-1', status: 'submitted', submitted_at: '2026-09-20T09:00:00+00:00' },
    ]))
    .rows('candidate.applied-jobs-page', [{ job_id: 'job-1', slug: 'magazynier', title: 'Magazynier', company_name: 'Firma', city: 'Gent' }])
    .rows('candidate.latest-messages', result('latestMessages', empty ? [] : [{
      id: 'conv-1', subject: 'Firma', last_message_at: '2026-09-21T09:00:00+00:00',
      last_body: 'Dzień dobry', last_created_at: '2026-09-21T09:00:00+00:00', unread: true,
    }]))
    .rows('candidate.profile-name', [])
    .rows('candidate.profile-completeness', []);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('odczyty pulpitu kandydata (#244)', () => {
  it('po udanym odczycie zwraca prawdziwe dane', async () => {
    db(null);
    await expect(getCandidateOverview()).resolves.toMatchObject({
      newJobsCount: 12, activeApplicationsCount: 4, unreadMessagesCount: 1,
    });
    await expect(getMyApplicationsPreview('pl')).resolves.toMatchObject({
      status: 'ok', items: [{ id: 'app-1', jobTitle: 'Magazynier' }],
    });
    await expect(getLatestMessages()).resolves.toMatchObject({
      status: 'ok', items: [{ id: 'conv-1', preview: 'Dzień dobry', unread: true }],
    });
    // Liczniki i wiadomości zawężone do właściciela sesji.
    expect(fakeDb.callsTo('candidate.active-applications')[0]).toMatchObject({ as: CANDIDATE });
    expect(fakeDb.callsTo('candidate.active-applications')[0]!.values).toEqual([
      CANDIDATE, ['submitted', 'viewed', 'shortlisted', 'interview', 'offer_sent', 'offer_accepted'],
    ]);
    expect(fakeDb.callsTo('candidate.unread-conversations')[0]!.values).toEqual([CANDIDATE]);
    expect(fakeDb.callsTo('candidate.latest-messages')[0]!.values).toEqual([CANDIDATE]);
    expect(fakeDb.callsTo('candidate.latest-messages')[0]!.text).toContain('LIMIT 3');
  });

  it('prawdziwie pusty wynik pozostaje pustym sukcesem, nie błędem', async () => {
    db(null, true);
    await expect(getMyApplicationsPreview('pl')).resolves.toEqual({ status: 'ok', items: [] });
    await expect(getLatestMessages()).resolves.toEqual({ status: 'ok', items: [] });
    await expect(getCandidateOverview()).resolves.toMatchObject({ unreadMessagesCount: 0 });
  });

  it.each([
    ['newJobs', 'newJobsCount'],
    ['activeApplications', 'activeApplicationsCount'],
    ['unreadConversations', 'unreadMessagesCount'],
  ] as const)('błąd odczytu %s nie jest zerem i nie zeruje pozostałych liczników', async (read, field) => {
    db(read);
    const overview = await getCandidateOverview();
    expect(overview[field]).toBeNull();
    const expected = { newJobsCount: 12, activeApplicationsCount: 4, unreadMessagesCount: 1 };
    for (const [key, value] of Object.entries(expected)) {
      if (key !== field) expect(overview[key as keyof typeof expected]).toBe(value);
    }
    expect(captureError).toHaveBeenCalledWith(readError, { area: `candidate.getCandidateOverview.${read === 'unreadConversations' ? 'unreadMessages' : read}` });
  });

  it('błąd listy zgłoszeń to stan błędu, nie pusta lista', async () => {
    db('applicationList');
    await expect(getMyApplicationsPreview('pl')).resolves.toEqual({ status: 'error' });
  });

  it('błąd odczytu wiadomości daje stan błędu, nie „brak wiadomości”', async () => {
    db('latestMessages');
    await expect(getLatestMessages()).resolves.toEqual({ status: 'error' });
  });
});
