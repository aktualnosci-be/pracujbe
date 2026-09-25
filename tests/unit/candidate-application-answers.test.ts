import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyApplicationScreeningAnswers, getMyApplicationsPage } from '@/lib/data/candidate';
import { loadApplicationScreeningAnswers } from '@/lib/actions/candidate-applications';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

/**
 * #101 — odpowiedzi na pytania screeningowe w historii zgłoszeń kandydata: licznik na
 * karcie (podzapytanie pod RLS) i snapshot odpowiedzi czytany pod sesją, zawężony do
 * własnego zgłoszenia. SQL i RLS na PostgreSQL 16: `tests/integration/portal-candidate.test.ts`.
 */
const ownerId = '22222222-2222-4222-8222-222222222222';
const appId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const jobId = '11111111-1111-4111-8111-111111111111';

const answerRows = [
  { position: 1, type: 'single_choice', required: true, prompt: { pl: 'Zmiana?', en: 'Shift?', de: 'x' }, options: [{ id: 'o1', label: { pl: 'Dzienna' } }], answer_boolean: null, answer_date: null, answer_text: 'o1' },
  { position: 0, type: 'date', required: false, prompt: { pl: 'Start?' }, options: [], answer_boolean: null, answer_date: '2026-10-05T00:00:00.000Z', answer_text: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: ownerId, role: 'candidate' });
});

describe('getMyApplicationScreeningAnswers', () => {
  it('reads the snapshot of the own application under the session, ordered by position', async () => {
    fakeDb.rows('candidate.application-screening-answers', () => answerRows);
    const answers = await getMyApplicationScreeningAnswers(appId);
    expect(answers.map((a) => a.position)).toEqual([0, 1]);
    expect(answers[0]).toMatchObject({ type: 'date', answerDate: '2026-10-05' });
    // Tylko obsługiwane języki snapshotu.
    expect(answers[1]!.prompt).toEqual({ pl: 'Zmiana?', en: 'Shift?' });
    const [call] = fakeDb.callsTo('candidate.application-screening-answers');
    expect(call!.as).toBe(ownerId);
    expect(call!.values).toEqual([appId, ownerId]);
    expect(call!.text).toContain('FROM public.application_screening_answers');
    expect(call!.text).toContain('a.candidate_id = $2');
    expect(call!.text).toContain('a.deleted_at IS NULL');
  });

  it('does not query without a session or for a non-UUID id', async () => {
    expect(await getMyApplicationScreeningAnswers('demo-app-0')).toEqual([]);
    resetFakeDb(null);
    expect(await getMyApplicationScreeningAnswers(appId)).toEqual([]);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('propagates a database failure instead of an empty list', async () => {
    fakeDb.rows('candidate.application-screening-answers', () => { throw pgError('08006', 'down'); });
    await expect(getMyApplicationScreeningAnswers(appId)).rejects.toThrow();
    // Akcja zamienia wyjątek na jawny stan błędu (ekran: komunikat + ponowienie).
    expect(await loadApplicationScreeningAnswers(appId)).toEqual({ status: 'error' });
  });
});

describe('loadApplicationScreeningAnswers', () => {
  it('returns the answers for a valid id', async () => {
    fakeDb.rows('candidate.application-screening-answers', () => answerRows);
    const result = await loadApplicationScreeningAnswers(appId);
    expect(result.status).toBe('ready');
    expect(result.status === 'ready' && result.answers).toHaveLength(2);
  });

  it.each([
    ['injected id', `${appId}' OR true --`],
    ['object', { id: appId }],
    ['empty', ''],
  ])('rejects %s before querying', async (_reason, value) => {
    expect(await loadApplicationScreeningAnswers(value)).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('screening count on the application card', () => {
  it('maps the per-application count from the page query', async () => {
    fakeDb
      .rows('candidate.applications-page', () => [
        { id: appId, job_id: jobId, status: 'submitted', submitted_at: '2026-09-20T09:00:00+00:00', screening_count: 2 },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000', job_id: jobId, status: 'viewed', submitted_at: '2026-09-19T09:00:00+00:00', screening_count: 0 },
      ])
      .rows('candidate.applied-jobs-page', () => []);
    const page = await getMyApplicationsPage('pl');
    expect(page.items.map((item) => item.screeningCount)).toEqual([2, 0]);
    const [call] = fakeDb.callsTo('candidate.applications-page');
    expect(call!.text).toContain('WHERE s.application_id = applications.id) AS screening_count');
  });
});
