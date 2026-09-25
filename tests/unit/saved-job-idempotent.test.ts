import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toggleSavedJob } from '@/lib/actions/candidate';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const jobId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

/**
 * Tabela `saved_jobs` w pamięci: unikat (candidate_id, job_id) jak w 0004, polityki RLS
 * „własne wiersze” jak w 0009. Wiersze przeżywają kolejne wywołania akcji (= odświeżenie strony).
 * INSERT z `ON CONFLICT (candidate_id, job_id) DO NOTHING` nie dubluje istniejącej pary.
 */
function savedJobsTable() {
  resetFakeDb({ id: userId, role: 'candidate' });
  const rows = new Set<string>();
  const inserts: string[] = [];
  const deletes: string[] = [];
  const keyOf = (values: unknown[]) => `${values[0]}:${values[1]}`;
  fakeDb
    .rows('candidate.saved-job-state', ({ values }) => (rows.has(keyOf(values)) ? [{ id: 'row' }] : []))
    .exec('candidate.saved-job-delete', ({ values }) => {
      const key = keyOf(values);
      deletes.push(key);
      return rows.delete(key) ? 1 : 0;
    })
    .exec('candidate.saved-job-insert', ({ values, text }) => {
      if (values[0] !== userId) throw pgError('42501', 'new row violates row-level security policy');
      const key = keyOf(values);
      inserts.push(key);
      if (rows.has(key)) {
        if (!/ON CONFLICT \(candidate_id, job_id\) DO NOTHING/.test(text)) throw pgError('23505', 'duplicate key');
        return 0;
      }
      rows.add(key);
      return 1;
    });
  return { rows, inserts, deletes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toggleSavedJob — idempotentny zapis oferty (#9)', () => {
  it('ponowienie „zapisz” zostawia jedną zapisaną ofertę, także po odświeżeniu', async () => {
    const db = savedJobsTable();
    expect(await toggleSavedJob(jobId, true)).toEqual({ ok: true, saved: true });
    // Retry po zgubionej odpowiedzi / druga karta / podwójne kliknięcie.
    expect(await toggleSavedJob(jobId, true)).toEqual({ ok: true, saved: true });
    expect(db.rows.size).toBe(1);
    expect(db.deletes).toHaveLength(0);
    // Zapis wyłącznie dla konta z sesji.
    expect(fakeDb.callsTo('candidate.saved-job-insert').every((call) => call.values[0] === userId && call.as === userId)).toBe(true);
  });

  it('kontrola ujemna: toggle bez stanu docelowego odwraca zapis przy ponowieniu', async () => {
    // Dokładnie ten błąd naprawia `desired`: to samo żądanie powtórzone kasuje zapis.
    const db = savedJobsTable();
    expect(await toggleSavedJob(jobId)).toEqual({ ok: true, saved: true });
    expect(await toggleSavedJob(jobId)).toEqual({ ok: true, saved: false });
    expect(db.rows.size).toBe(0);
  });

  it('wyścig insertów tej samej pary (unikat) to sukces, nie fałszywy błąd', async () => {
    const db = savedJobsTable();
    const [first, second] = await Promise.all([
      toggleSavedJob(jobId, true),
      toggleSavedJob(jobId, true),
    ]);
    expect(first).toEqual({ ok: true, saved: true });
    expect(second).toEqual({ ok: true, saved: true });
    expect(db.rows.size).toBe(1);
  });

  it('ponowienie „usuń” jest idempotentne', async () => {
    const db = savedJobsTable();
    await toggleSavedJob(jobId, true);
    expect(await toggleSavedJob(jobId, false)).toEqual({ ok: true, saved: false });
    expect(await toggleSavedJob(jobId, false)).toEqual({ ok: true, saved: false });
    expect(db.rows.size).toBe(0);
    expect(db.inserts).toHaveLength(1);
  });

  it('inny błąd zapisu nie udaje sukcesu', async () => {
    savedJobsTable();
    fakeDb.exec('candidate.saved-job-insert', () => {
      throw pgError('42501', 'new row violates row-level security policy');
    });
    expect(await toggleSavedJob(jobId, true)).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('bez sesji nie zapisuje', async () => {
    savedJobsTable();
    resetFakeDb(null);
    expect(await toggleSavedJob(jobId, true)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('odrzuca niepoprawny stan docelowy przed połączeniem', async () => {
    savedJobsTable();
    expect(await toggleSavedJob(jobId, 'yes' as never)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
