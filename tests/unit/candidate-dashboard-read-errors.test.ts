import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCandidateOverview, getLatestMessages, getMyApplicationsPreview } from '@/lib/data/candidate';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

/** Odczyty pulpitu, które test kolejno psuje (#244). */
type Read = 'newJobs' | 'activeApplications' | 'members' | 'messages' | 'applicationList' | 'conversations';

const readError = { code: 'read-failed' };

/** Łańcuch PostgREST: każda metoda zwraca łańcuch, `await` daje wynik zależny od zapytania. */
function chain(resolve: (state: { head: boolean }) => unknown) {
  const state = { head: false };
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit', 'or']) {
    query[method] = vi.fn((_: unknown, options?: { head?: boolean }) => {
      if (method === 'select' && options?.head) state.head = true;
      return query;
    });
  }
  query['then'] = (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) =>
    Promise.resolve(resolve(state)).then(ok, fail);
  return query;
}

function client(failed: Read | null, empty = false) {
  const result = (read: Read, data: unknown, extra: Record<string, unknown> = {}) =>
    failed === read ? { data: null, count: null, error: readError } : { data, error: null, ...extra };
  const supabase = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'candidate-1' } } })) },
    rpc: vi.fn(async (name: string) => {
      if (name === 'get_public_jobs_count') return result('newJobs', 12);
      return { data: [{ job_id: 'job-1', slug: 'magazynier', title: 'Magazynier', company_name: 'Firma', city: 'Gent' }], error: null };
    }),
    from: vi.fn((table: string) => chain(({ head }) => {
      if (table === 'applications') {
        return head
          ? result('activeApplications', null, { count: 4 })
          : result('applicationList', empty ? [] : [{ id: 'app-1', job_id: 'job-1', status: 'submitted', submitted_at: '2026-09-20T09:00:00+00:00' }]);
      }
      if (table === 'conversation_members') {
        return result('members', empty ? [] : [{ conversation_id: 'conv-1', last_read_at: null }]);
      }
      if (table === 'conversations') {
        return result('conversations', [{ id: 'conv-1', subject: 'Firma', last_message_at: '2026-09-21T09:00:00+00:00' }]);
      }
      if (table === 'messages') {
        return result('messages', [{ conversation_id: 'conv-1', body: 'Dzień dobry', sender_id: 'recruiter-1', created_at: '2026-09-21T09:00:00+00:00' }]);
      }
      return { data: null, error: null };
    })),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('odczyty pulpitu kandydata (#244)', () => {
  it('po udanym odczycie zwraca prawdziwe dane', async () => {
    client(null);
    await expect(getCandidateOverview()).resolves.toMatchObject({
      newJobsCount: 12, activeApplicationsCount: 4, unreadMessagesCount: 1,
    });
    await expect(getMyApplicationsPreview('pl')).resolves.toMatchObject({
      status: 'ok', items: [{ id: 'app-1', jobTitle: 'Magazynier' }],
    });
    await expect(getLatestMessages()).resolves.toMatchObject({
      status: 'ok', items: [{ id: 'conv-1', preview: 'Dzień dobry', unread: true }],
    });
  });

  it('prawdziwie pusty wynik pozostaje pustym sukcesem, nie błędem', async () => {
    client(null, true);
    await expect(getMyApplicationsPreview('pl')).resolves.toEqual({ status: 'ok', items: [] });
    await expect(getLatestMessages()).resolves.toEqual({ status: 'ok', items: [] });
    await expect(getCandidateOverview()).resolves.toMatchObject({ unreadMessagesCount: 0 });
  });

  it.each([
    ['newJobs', 'newJobsCount'],
    ['activeApplications', 'activeApplicationsCount'],
    ['members', 'unreadMessagesCount'],
    ['messages', 'unreadMessagesCount'],
  ] as const)('błąd odczytu %s nie jest zerem i nie zeruje pozostałych liczników', async (read, field) => {
    client(read);
    const overview = await getCandidateOverview();
    expect(overview[field]).toBeNull();
    const expected = { newJobsCount: 12, activeApplicationsCount: 4, unreadMessagesCount: 1 };
    for (const [key, value] of Object.entries(expected)) {
      if (key !== field) expect(overview[key as keyof typeof expected]).toBe(value);
    }
  });

  it('błąd listy zgłoszeń to stan błędu, nie pusta lista', async () => {
    client('applicationList');
    await expect(getMyApplicationsPreview('pl')).resolves.toEqual({ status: 'error' });
  });

  it.each(['members', 'conversations', 'messages'] as const)(
    'błąd odczytu %s daje stan błędu wiadomości, nie „brak wiadomości”', async (read) => {
      client(read);
      await expect(getLatestMessages()).resolves.toEqual({ status: 'error' });
    },
  );
});
