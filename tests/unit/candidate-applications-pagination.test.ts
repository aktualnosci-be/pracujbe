import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyApplicationsPage } from '@/lib/data/candidate';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const ownerId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';
const submittedAt = '2026-09-20T09:00:00+00:00';
const records = Array.from({ length: 15 }, (_, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(15 - index).padStart(12, '0')}`,
  job_id: jobId,
  status: 'submitted',
  submitted_at: submittedAt,
}));

type AppliedJobRow = { job_id: string; slug: string; title: string; company_name: string };
type AppRow = (typeof records)[number];

/**
 * Atrapa SQL strony historii: `WHERE candidate_id = $1 AND (submitted_at, id) < ($2, $3)
 * ORDER BY submitted_at DESC, id DESC LIMIT $4` na wierszach w pamięci (już posortowanych).
 * Metadane: `get_applied_jobs_display(...) WHERE job_id = ANY($2)`; `transferred` liczy
 * wiersze, które faktycznie opuściły „bazę”.
 */
function db(options: { fail?: boolean; userId?: string | null; rows?: AppRow[]; history?: AppliedJobRow[] } = {}) {
  resetFakeDb(options.userId === null ? null : { id: options.userId ?? ownerId, role: 'candidate' });
  const stats = { transferred: 0 };
  const history = options.history ?? [{ job_id: jobId, slug: 'older-job', title: 'Older job', company_name: 'Company' }];
  fakeDb
    .rows('candidate.applications-page', ({ values }) => {
      if (options.fail) throw pgError('08006', 'database unavailable');
      const [candidate, beforeDate, beforeId, limit] = values as [string, string | null, string | null, number];
      expect(candidate).toBe(ownerId);
      return (options.rows ?? records).filter((row) =>
        !beforeDate || row.submitted_at < beforeDate || (row.submitted_at === beforeDate && row.id < beforeId!),
      ).slice(0, limit);
    })
    .rows('candidate.applied-jobs-page', ({ values }) => {
      const ids = values[1] as string[];
      const rows = history.filter((row) => ids.includes(row.job_id));
      stats.transferred += rows.length;
      return rows;
    });
  return { stats };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('candidate application history', () => {
  it('reaches all 15 own applications through a tie-safe cursor without repeats', async () => {
    db();
    const first = await getMyApplicationsPage('pl');
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toEqual({ submittedAt, id: records[9]!.id });
    const second = await getMyApplicationsPage('pl', first.nextCursor);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(15);

    const [firstCall, secondCall] = fakeDb.callsTo('candidate.applications-page');
    // Zapytanie zawężone do właściciela sesji, bez usuniętych, stabilna kolejność i limit strony + 1.
    expect(firstCall!.as).toBe(ownerId);
    expect(firstCall!.values).toEqual([ownerId, null, null, 11]);
    expect(firstCall!.text).toContain('candidate_id = $1');
    expect(firstCall!.text).toContain('deleted_at IS NULL');
    expect(firstCall!.text).toContain('(submitted_at, id) < ($2::timestamptz, $3::uuid)');
    expect(firstCall!.text).toContain('ORDER BY submitted_at DESC, id DESC');
    expect(secondCall!.values).toEqual([ownerId, submittedAt, records[9]!.id, 11]);
    expect(fakeDb.callsTo('candidate.applied-jobs-page')[0]!.values[0]).toBe('pl');
    expect(fakeDb.callsTo('candidate.applied-jobs-page')[0]!.text).toContain('get_applied_jobs_display');
    expect(second.items.every((row) => row.jobTitle === 'Older job' && row.slug === 'older-job')).toBe(true);
  });

  it('does not query applications without a session', async () => {
    db({ userId: null });
    expect(await getMyApplicationsPage('pl')).toEqual({ items: [], nextCursor: null });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('uses date before ID when older applications have larger UUIDs', async () => {
    const mixed = [
      ...records.slice(0, 8).map((row, index) => ({ ...row, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(8 - index).padStart(12, '0')}` })),
      ...records.slice(8).map((row, index) => ({
        ...row,
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(15 - index).padStart(12, '0')}`,
        submitted_at: '2026-09-19T09:00:00+00:00',
      })),
    ];
    db({ rows: mixed });
    const first = await getMyApplicationsPage('pl');
    const second = await getMyApplicationsPage('pl', first.nextCursor);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(15);
    expect(second.items.every((row) => row.date === '2026-09-19T09:00:00+00:00')).toBe(true);
  });

  it('does not disguise a failed page read as an empty page', async () => {
    db({ fail: true });
    await expect(getMyApplicationsPage('pl')).rejects.toMatchObject({ message: 'database unavailable' });
  });

  // #180: granica strony — 10 zgłoszeń to koniec listy, jedenaste musi dać kursor, nie zniknąć.
  it('treats exactly 10 applications as the end of the list', async () => {
    db({ rows: records.slice(0, 10) });
    const page = await getMyApplicationsPage('pl');
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
    expect(fakeDb.callsTo('candidate.applications-page')).toHaveLength(1);
  });

  it('keeps the 11th application reachable on the next page', async () => {
    db({ rows: records.slice(0, 11) });
    const first = await getMyApplicationsPage('pl');
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toEqual({ submittedAt, id: records[9]!.id });
    const second = await getMyApplicationsPage('pl', first.nextCursor);
    expect(second.items.map((row) => row.id)).toEqual([records[10]!.id]);
    expect(second.nextCursor).toBeNull();
  });

  // #184: metadane ofert tylko dla rekordów bieżącej strony, nie całej historii.
  describe('job metadata scoped to the current page', () => {
    const jobIdAt = (index: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`;
    const longHistory = Array.from({ length: 120 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(120 - index).padStart(12, '0')}`,
      job_id: jobIdAt(index),
      status: 'submitted',
      submitted_at: submittedAt,
    }));
    const history: AppliedJobRow[] = longHistory.map((row, index) => ({
      job_id: row.job_id, slug: `job-${index}`, title: `Job ${index}`, company_name: `Company ${index}`,
    }));

    it('asks only for the job IDs of the page, also on the next page of 120+ applications', async () => {
      const { stats } = db({ rows: longHistory, history });
      const first = await getMyApplicationsPage('pl');
      const metadataCalls = () => fakeDb.callsTo('candidate.applied-jobs-page');
      expect(metadataCalls()[0]!.values[1]).toEqual(longHistory.slice(0, 10).map((row) => row.job_id));
      expect(first.items.map((row) => row.jobTitle)).toEqual(history.slice(0, 10).map((row) => row.title));

      const second = await getMyApplicationsPage('pl', first.nextCursor);
      expect(metadataCalls()).toHaveLength(2);
      expect(metadataCalls()[1]!.values[1]).toEqual(longHistory.slice(10, 20).map((row) => row.job_id));
      expect(second.items.map((row) => row.slug)).toEqual(history.slice(10, 20).map((row) => row.slug));
      // Dwie strony = 20 wierszy metadanych, nie 2 × 120.
      expect(stats.transferred).toBe(20);
    });

    it('sends each job ID once when several applications on a page share an offer', async () => {
      const shared = longHistory.slice(0, 10).map((row) => ({ ...row, job_id: jobIdAt(0) }));
      db({ rows: shared, history });
      const page = await getMyApplicationsPage('pl');
      expect(fakeDb.callsTo('candidate.applied-jobs-page')[0]!.values[1]).toEqual([jobIdAt(0)]);
      expect(page.items.every((row) => row.jobTitle === 'Job 0')).toBe(true);
    });

    it('skips the metadata read for an empty page', async () => {
      db({ rows: [] });
      expect(await getMyApplicationsPage('pl')).toEqual({ items: [], nextCursor: null });
      expect(fakeDb.callsTo('candidate.applied-jobs-page')).toHaveLength(0);
    });

    it('propagates a failed metadata read instead of rendering nameless cards', async () => {
      db({ rows: longHistory });
      fakeDb.rows('candidate.applied-jobs-page', () => { throw pgError('XX000', 'metadata unavailable'); });
      await expect(getMyApplicationsPage('pl')).rejects.toMatchObject({ message: 'metadata unavailable' });
    });

    // Kontrola ujemna: ten sam licznik wychwytuje odczyt bez ograniczenia do strony.
    it('negative control: an unscoped read transfers the whole history and fails the page bound', async () => {
      const { stats } = db({ rows: longHistory, history });
      fakeDb.rows('candidate.applied-jobs-page', () => {
        stats.transferred += history.length;
        return history;
      });
      await getMyApplicationsPage('pl');
      expect(stats.transferred).toBe(120);
      expect(stats.transferred).toBeGreaterThan(10);
    });
  });
});
