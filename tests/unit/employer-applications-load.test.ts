import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPLOYER_APPLICATIONS_PAGE_SIZE, getEmployerApplicationsPage } from '@/lib/data/employer';
import { getActiveCompany } from '@/lib/company-context';
import { captureError } from '@/lib/error-report';
import { decodeTimeCursor, encodeTimeCursor } from '@/lib/employer/list-cursor';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const APP = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const TS = '2026-09-20T09:00:00.123456+00:00';

function db(rows: unknown[], error: unknown = null) {
  for (const name of ['employer.applications-page', 'employer.applications-page-prev']) {
    fakeDb.rows(name, () => {
      if (error) throw error;
      return rows;
    });
  }
}

function row(n: number) {
  return {
    id: APP(n), status: 'submitted', candidate_id: `cand-${n}`, submitted_at: TS,
    profiles: { first_name: 'Ada', last_name: 'Nowak' }, jobs: { title: 'Operator' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1', activeStatus: 'verified', activeName: 'Firma',
    activeRole: 'owner', companies: [],
  });
});

describe('employer applications page data (P1-05: kursor)', () => {
  it('returns a separate error state instead of an empty list on read failure', async () => {
    const error = pgError('XX000', 'DATABASE_UNAVAILABLE');
    db([], error);
    expect(await getEmployerApplicationsPage()).toEqual({ status: 'error' });
    expect(fakeDb.callsTo('employer.applications-page')[0]?.values[0]).toBe('company-1');
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.getEmployerApplicationsPage' });
  });

  it('first page: keyset without OFFSET, one extra row exposes the older cursor', async () => {
    db(Array.from({ length: EMPLOYER_APPLICATIONS_PAGE_SIZE + 1 }, (_, i) => row(20 - i)));
    const result = await getEmployerApplicationsPage();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.applications).toHaveLength(EMPLOYER_APPLICATIONS_PAGE_SIZE);
    expect(result.applications[0]).toEqual({ id: APP(20), candidateName: 'Ada Nowak', jobTitle: 'Operator', status: 'submitted' });
    expect(result.prevCursor).toBeNull();
    // Kursor = ostatnia WIDOCZNA pozycja (nie znacznik), czas z pełną precyzją.
    expect(decodeTimeCursor(result.nextCursor)).toEqual({ ts: TS, id: APP(20 - EMPLOYER_APPLICATIONS_PAGE_SIZE + 1) });
    const [call] = fakeDb.callsTo('employer.applications-page');
    expect(call?.values).toEqual(['company-1', null, null, null, 13]);
    expect(call?.text).toContain('ORDER BY a.submitted_at DESC, a.id DESC');
    expect(call?.text).toContain('(a.submitted_at, a.id) < ($3::timestamptz, $4::uuid)');
    expect(call?.text).not.toContain('OFFSET');
    expect(call?.text).toContain('a.deleted_at IS NULL');
    expect(call?.as).toBe(USER);
  });

  it('older page passes the cursor and exposes the way back', async () => {
    db([row(3), row(2)]);
    const cursor = { ts: TS, id: APP(4) };
    const result = await getEmployerApplicationsPage({ cursor, direction: 'next' });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(fakeDb.callsTo('employer.applications-page')[0]?.values).toEqual(['company-1', null, TS, APP(4), 13]);
    expect(result.nextCursor).toBeNull();
    expect(decodeTimeCursor(result.prevCursor)).toEqual({ ts: TS, id: APP(3) });
  });

  it('newer page reads ascending and returns the list order', async () => {
    // Baza zwraca rosnąco (najbliższe kursorowi pierwsze) + znacznik kolejnej nowszej strony.
    db(Array.from({ length: EMPLOYER_APPLICATIONS_PAGE_SIZE + 1 }, (_, i) => row(5 + i)));
    const result = await getEmployerApplicationsPage({ cursor: { ts: TS, id: APP(4) }, direction: 'prev' });
    if (result.status !== 'ok') throw new Error('expected ok');
    const [call] = fakeDb.callsTo('employer.applications-page-prev');
    expect(call?.text).toContain('(a.submitted_at, a.id) > ($3::timestamptz, $4::uuid)');
    expect(call?.text).toContain('ORDER BY a.submitted_at ASC, a.id ASC');
    expect(result.applications.map((a) => a.id)).toEqual(
      Array.from({ length: EMPLOYER_APPLICATIONS_PAGE_SIZE }, (_, i) => APP(5 + EMPLOYER_APPLICATIONS_PAGE_SIZE - 1 - i)));
    expect(decodeTimeCursor(result.prevCursor)?.id).toBe(APP(5 + EMPLOYER_APPLICATIONS_PAGE_SIZE - 1));
    expect(decodeTimeCursor(result.nextCursor)?.id).toBe(APP(5));
  });

  it('filters by a job of the active company; a foreign job is not found', async () => {
    db([row(1)]);
    fakeDb.rows('employer.applications-job', ({ values }) => (values[0] === JOB ? [{ id: JOB, title: 'Operator' }] : []));
    const own = await getEmployerApplicationsPage(undefined, JOB);
    expect(own).toMatchObject({ status: 'ok', job: { id: JOB, title: 'Operator' } });
    expect(fakeDb.callsTo('employer.applications-job')[0]?.values).toEqual([JOB, 'company-1']);
    expect(fakeDb.callsTo('employer.applications-page')[0]?.values[1]).toBe(JOB);

    const foreign = await getEmployerApplicationsPage(undefined, '33333333-3333-4333-8333-333333333333');
    expect(foreign).toEqual({ status: 'not_found' });
    expect(await getEmployerApplicationsPage(undefined, 'not-a-uuid')).toEqual({ status: 'not_found' });
  });

  it('shows a guest application with its snapshot name (#98)', async () => {
    db([{ id: APP(1), status: 'submitted', candidate_id: null, guest_name: 'Jan Gość', profiles: null, jobs: { title: 'Operator' }, submitted_at: TS }]);
    const result = await getEmployerApplicationsPage();
    expect(result.status === 'ok' && result.applications[0]).toEqual({
      id: APP(1), candidateName: 'Jan Gość', jobTitle: 'Operator', status: 'submitted', isGuest: true,
    });
  });

  it('shows an actual empty state after a successful read', async () => {
    db([]);
    expect(await getEmployerApplicationsPage()).toEqual({
      status: 'ok', applications: [], prevCursor: null, nextCursor: null, isDemo: false, job: null,
    });
  });

  it('does not read applications without an active company', async () => {
    db([]);
    vi.mocked(getActiveCompany).mockResolvedValueOnce({
      activeId: null, activeStatus: 'unverified', activeName: '', activeRole: 'member', companies: [],
    });
    expect(await getEmployerApplicationsPage()).toEqual({
      status: 'ok', applications: [], prevCursor: null, nextCursor: null, isDemo: false, job: null,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('marks synthetic data clearly and does not spill it into later pages', async () => {
    fakeSession.configured = false;
    const first = await getEmployerApplicationsPage();
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.isDemo).toBe(true);
    expect(first.applications.length).toBeGreaterThan(0);
    expect(await getEmployerApplicationsPage({ cursor: { ts: TS, id: APP(1) }, direction: 'next' })).toEqual({
      status: 'ok', applications: [], prevCursor: null, nextCursor: null, isDemo: true, job: null,
    });
    expect(fakeDb.calls).toHaveLength(0);
    expect(encodeTimeCursor({ ts: TS, id: APP(1) })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
