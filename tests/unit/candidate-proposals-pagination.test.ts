import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyOffersPage } from '@/lib/data/candidate';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const ownerId = '22222222-2222-4222-8222-222222222222';
const jobId = '11111111-1111-4111-8111-111111111111';
const createdAt = '2026-09-20T09:00:00+00:00';
/** 21 propozycji o RÓWNYM created_at — kolejność rozstrzyga wyłącznie UUID. */
const records = Array.from({ length: 21 }, (_, index) => ({
  id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(21 - index).padStart(12, '0')}`,
  job_id: jobId,
  status: index === 20 ? 'accepted' : 'sent',
  message: `Propozycja ${21 - index}`,
  sent_at: createdAt,
  created_at: createdAt,
  expires_at: null,
}));

/** Atrapa SQL strony: `(created_at, id) < ($2, $3) ORDER BY created_at DESC, id DESC LIMIT $4`. */
function db(options: { fail?: boolean; userId?: string | null; rows?: typeof records } = {}) {
  resetFakeDb(options.userId === null ? null : { id: options.userId ?? ownerId, role: 'candidate' });
  fakeDb
    .rows('candidate.offers-page', ({ values }) => {
      if (options.fail) throw pgError('08006', 'database unavailable');
      const [, beforeDate, beforeId, limit] = values as [string, string | null, string | null, number];
      return (options.rows ?? records).filter((row) =>
        !beforeDate || row.created_at < beforeDate || (row.created_at === beforeDate && row.id < beforeId!),
      ).slice(0, limit);
    })
    .rpc('get_applied_jobs_display', [{ job_id: jobId, slug: 'older-job', title: 'Older job', company_name: 'Company' }])
    .rpc('get_offered_jobs_display', []);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('historia propozycji kandydata (#245)', () => {
  it('udostępnia wszystkie 21 własnych propozycji bez powtórzeń przy równym czasie', async () => {
    db();
    const pages = [await getMyOffersPage('pl')];
    while (pages[pages.length - 1]!.nextCursor) {
      pages.push(await getMyOffersPage('pl', pages[pages.length - 1]!.nextCursor));
      expect(pages.length).toBeLessThan(10);
    }
    const all = pages.flatMap((page) => page.items);
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 1]);
    expect(all).toHaveLength(21);
    expect(new Set(all.map((item) => item.id)).size).toBe(21);
    // Najstarsza propozycja (po zmianie statusu) jest osiągalna, z poprawnym statusem i treścią.
    expect(all[20]).toMatchObject({ id: records[20]!.id, status: 'accepted', message: 'Propozycja 1', jobTitle: 'Older job' });
    const calls = fakeDb.callsTo('candidate.offers-page');
    expect(calls[0]).toMatchObject({ as: ownerId, values: [ownerId, null, null, 11] });
    expect(calls[0]!.text).toContain('candidate_id = $1');
    expect(calls[0]!.text).toContain('deleted_at IS NULL');
    expect(calls[0]!.text).toContain('(created_at, id) < ($2::timestamptz, $3::uuid)');
    expect(calls[0]!.text).toContain('ORDER BY created_at DESC, id DESC');
    expect(calls[1]!.values).toEqual([ownerId, createdAt, records[9]!.id, 11]);
    // #184: metadane z własnych aplikacji tylko dla ofert bieżącej strony.
    expect(fakeDb.callsTo('get_applied_jobs_display')[0]!.args).toEqual({ p_locale: 'pl', p_job_ids: [jobId] });
  });

  it('stosuje datę przed UUID, gdy starsze propozycje mają większe identyfikatory', async () => {
    const mixed = [
      ...records.slice(0, 8).map((row, index) => ({ ...row, id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(8 - index).padStart(12, '0')}` })),
      ...records.slice(8).map((row, index) => ({
        ...row,
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(21 - index).padStart(12, '0')}`,
        created_at: '2026-09-19T09:00:00+00:00',
      })),
    ];
    db({ rows: mixed });
    const first = await getMyOffersPage('pl');
    const second = await getMyOffersPage('pl', first.nextCursor);
    const third = await getMyOffersPage('pl', second.nextCursor);
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect(third.nextCursor).toBeNull();
  });

  it('nie odpytuje propozycji bez sesji', async () => {
    db({ userId: null });
    expect(await getMyOffersPage('pl')).toEqual({ items: [], nextCursor: null });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('nie udaje pustej strony po błędzie odczytu', async () => {
    db({ fail: true });
    await expect(getMyOffersPage('pl')).rejects.toMatchObject({ message: 'database unavailable' });
  });
});
