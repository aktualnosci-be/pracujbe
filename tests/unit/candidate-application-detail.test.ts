import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyApplicationDetail, getMyApplicationHistoryPage } from '@/lib/data/candidate';
import { loadMoreMyApplicationHistory } from '@/lib/actions/candidate-applications';
import { screeningAnswerText } from '@/lib/screening/answer-text';
import { captureError } from '@/lib/error-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

/**
 * Szczegół własnego zgłoszenia kandydata (P1-05/P1-06, strona kandydata): stany odczytu,
 * zawężenie do sesji i stronicowanie historii statusów. SQL i RLS na PostgreSQL 16 (z kontrolą
 * ujemną warunku `candidate_id`): `tests/integration/portal-candidate.test.ts`.
 */
const ownerId = '22222222-2222-4222-8222-222222222222';
const appId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const jobId = '11111111-1111-4111-8111-111111111111';
const convId = 'cccccccc-cccc-4ccc-8ccc-000000000001';

function historyRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}`,
    to_status: i === 0 ? 'submitted' : 'viewed',
    created_at: `2026-09-20T09:00:${String(i % 60).padStart(2, '0')}.000Z`,
  }));
}

function mockDetail({ history = historyRows(2), row = true } = {}) {
  fakeDb
    .rows('candidate.application-detail', () => (row ? [{
      id: appId, job_id: jobId, status: 'viewed', submitted_at: '2026-09-20T09:00:00Z',
      message: '  Dzień dobry  ', phone: '+32 470 00 00 00', availability: 'within_month',
    }] : []))
    .rows('candidate.applied-jobs-page', [{ job_id: jobId, slug: 'magazynier-gent', title: 'Magazynier', company_name: 'Firma A', city: 'Gent' }])
    .rows('candidate.application-detail-history', () => history)
    .rows('candidate.application-detail-answers', [])
    .rows('candidate.application-detail-conversation', [{ id: convId }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: ownerId, role: 'candidate' });
});

describe('getMyApplicationDetail', () => {
  it('reads only the own application under the session and joins job, history and conversation', async () => {
    mockDetail();
    const result = await getMyApplicationDetail('pl', appId);
    expect(result).toMatchObject({
      status: 'ok',
      isDemo: false,
      application: {
        id: appId, status: 'viewed', jobTitle: 'Magazynier', companyName: 'Firma A', city: 'Gent',
        slug: 'magazynier-gent', message: 'Dzień dobry', phone: '+32 470 00 00 00',
        availability: 'within_month', conversationId: convId, historyNextCursor: null,
      },
    });
    const [call] = fakeDb.callsTo('candidate.application-detail');
    expect(call!.as).toBe(ownerId);
    expect(call!.values).toEqual([appId, ownerId]);
    expect(call!.text).toContain('candidate_id = $2');
    expect(call!.text).toContain('deleted_at IS NULL');
    // Historia: tylko status i czas — notatka pracodawcy (`note`) nie jest czytana.
    const [history] = fakeDb.callsTo('candidate.application-detail-history');
    expect(history!.text).not.toMatch(/\bnote\b/);
  });

  it('pages the history: 51 rows → 50 shown and a cursor on the last shown entry', async () => {
    const rows = historyRows(51);
    mockDetail({ history: rows });
    const result = await getMyApplicationDetail('pl', appId);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.application.history).toHaveLength(50);
    expect(result.application.historyNextCursor).toEqual({ createdAt: rows[49]!.created_at, id: rows[49]!.id });
    expect(fakeDb.callsTo('candidate.application-detail-history')[0]!.values).toEqual([appId, 51]);
  });

  it('missing, foreign or deleted application = not_found, without further reads', async () => {
    mockDetail({ row: false });
    expect(await getMyApplicationDetail('pl', appId)).toEqual({ status: 'not_found' });
    expect(fakeDb.callsTo('candidate.application-detail-history')).toHaveLength(0);
  });

  it('a non-UUID id or no session does not query the database', async () => {
    expect(await getMyApplicationDetail('pl', 'demo-app-0')).toEqual({ status: 'not_found' });
    resetFakeDb(null);
    expect(await getMyApplicationDetail('pl', appId)).toEqual({ status: 'not_found' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('a database failure is an explicit error state, never an empty detail', async () => {
    fakeDb.rows('candidate.application-detail', () => { throw pgError('08006', 'down'); });
    expect(await getMyApplicationDetail('pl', appId)).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'candidate.getMyApplicationDetail' });
  });

  it('demo mode (no database) serves sample data marked as demo', async () => {
    fakeSession.configured = false;
    const result = await getMyApplicationDetail('pl', 'demo-app-2');
    expect(result).toMatchObject({ status: 'ok', isDemo: true, application: { id: 'demo-app-2', status: 'interview' } });
    if (result.status !== 'ok') return;
    expect(result.application.history.map((h) => h.toStatus)).toEqual(['submitted', 'interview']);
    expect(await getMyApplicationDetail('pl', 'demo-app-99')).toEqual({ status: 'not_found' });
  });
});

describe('getMyApplicationHistoryPage / loadMoreMyApplicationHistory', () => {
  const cursor = { createdAt: '2026-09-20T09:00:49.000Z', id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000050' };

  it('checks ownership first, then reads the next page after the cursor', async () => {
    fakeDb.rows('candidate.application-history-owner', [{ '?column?': 1 }])
      .rows('candidate.application-history-page', historyRows(3));
    const page = await getMyApplicationHistoryPage(appId, cursor);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    expect(fakeDb.callsTo('candidate.application-history-owner')[0]!.values).toEqual([appId, ownerId]);
    expect(fakeDb.callsTo('candidate.application-history-page')[0]!.values).toEqual([appId, cursor.createdAt, cursor.id, 51]);
  });

  it('a foreign application gives an empty page without reading its history', async () => {
    fakeDb.rows('candidate.application-history-owner', []);
    expect(await getMyApplicationHistoryPage(appId, cursor)).toEqual({ items: [], nextCursor: null });
    expect(fakeDb.callsTo('candidate.application-history-page')).toHaveLength(0);
  });

  it('the action rejects an untrusted id or cursor and maps a failure to an error state', async () => {
    expect(await loadMoreMyApplicationHistory('not-a-uuid', cursor)).toEqual({ status: 'error' });
    expect(await loadMoreMyApplicationHistory(appId, { createdAt: 'yesterday', id: cursor.id })).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
    fakeDb.rows('candidate.application-history-owner', () => { throw pgError('08006', 'down'); });
    expect(await loadMoreMyApplicationHistory(appId, cursor)).toEqual({ status: 'error' });
  });
});

describe('screeningAnswerText', () => {
  const labels = { yes: 'Tak', no: 'Nie', noAnswer: 'Brak odpowiedzi' };
  const base = { position: 0, required: false, prompt: { pl: 'P' }, options: [], answerBoolean: null, answerDate: null, answerText: null };

  it('formats each answer type from the snapshot, missing answer → label', () => {
    expect(screeningAnswerText({ ...base, type: 'yes_no', answerBoolean: false }, 'pl', labels)).toBe('Nie');
    expect(screeningAnswerText({ ...base, type: 'date', answerDate: '2026-10-05' }, 'pl', labels)).toBe('5 października 2026');
    expect(screeningAnswerText({
      ...base, type: 'single_choice', answerText: 'o2',
      options: [{ id: 'o1', label: { pl: 'Dzienna' } }, { id: 'o2', label: { pl: 'Nocna' } }],
    }, 'pl', labels)).toBe('Nocna');
    expect(screeningAnswerText({ ...base, type: 'short_text', answerText: 'Tekst' }, 'pl', labels)).toBe('Tekst');
    expect(screeningAnswerText({ ...base, type: 'short_text' }, 'pl', labels)).toBe('Brak odpowiedzi');
  });
});
