import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toggleSavedJob } from '@/lib/actions/candidate';
import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));

const jobId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

/**
 * Tabela `saved_jobs` w pamięci: unikat (candidate_id, job_id) jak w 0004, polityki RLS
 * „własne wiersze” jak w 0009. Wiersze przeżywają kolejne wywołania akcji (= odświeżenie strony).
 */
function fakeDb() {
  const rows = new Set<string>();
  const inserts: string[] = [];
  const deletes: string[] = [];
  const keyOf = (candidate: unknown, job: unknown) => `${candidate}:${job}`;
  const table = () => {
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'delete' = 'select';
    const q = {
      select: () => q,
      delete: () => {
        mode = 'delete';
        return q;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        if (mode === 'delete' && 'candidate_id' in filters && 'job_id' in filters) {
          const key = keyOf(filters.candidate_id, filters.job_id);
          deletes.push(key);
          rows.delete(key);
          return Promise.resolve({ error: null });
        }
        return q;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: rows.has(keyOf(filters.candidate_id, filters.job_id)) ? { id: 'row' } : null,
          error: null,
        }),
      insert: (row: { candidate_id: string; job_id: string }) => {
        if (row.candidate_id !== userId)
          return Promise.resolve({ error: { code: '42501', message: 'row-level security' } });
        const key = keyOf(row.candidate_id, row.job_id);
        inserts.push(key);
        if (rows.has(key))
          return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
        rows.add(key);
        return Promise.resolve({ error: null });
      },
    };
    return q;
  };
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn(() => table()),
  } as never);
  return { rows, inserts, deletes };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('toggleSavedJob — idempotentny zapis oferty (#9)', () => {
  it('ponowienie „zapisz” zostawia jedną zapisaną ofertę, także po odświeżeniu', async () => {
    const db = fakeDb();
    expect(await toggleSavedJob(jobId, true)).toEqual({ ok: true, saved: true });
    // Retry po zgubionej odpowiedzi / druga karta / podwójne kliknięcie.
    expect(await toggleSavedJob(jobId, true)).toEqual({ ok: true, saved: true });
    expect(db.rows.size).toBe(1);
    expect(db.deletes).toHaveLength(0);
  });

  it('kontrola ujemna: toggle bez stanu docelowego odwraca zapis przy ponowieniu', async () => {
    // Dokładnie ten błąd naprawia `desired`: to samo żądanie powtórzone kasuje zapis.
    const db = fakeDb();
    expect(await toggleSavedJob(jobId)).toEqual({ ok: true, saved: true });
    expect(await toggleSavedJob(jobId)).toEqual({ ok: true, saved: false });
    expect(db.rows.size).toBe(0);
  });

  it('wyścig insertów tej samej pary (unikat 23505) to sukces, nie fałszywy błąd', async () => {
    const db = fakeDb();
    const [first, second] = await Promise.all([
      toggleSavedJob(jobId, true),
      toggleSavedJob(jobId, true),
    ]);
    expect(first).toEqual({ ok: true, saved: true });
    expect(second).toEqual({ ok: true, saved: true });
    expect(db.rows.size).toBe(1);
  });

  it('ponowienie „usuń” jest idempotentne', async () => {
    const db = fakeDb();
    await toggleSavedJob(jobId, true);
    expect(await toggleSavedJob(jobId, false)).toEqual({ ok: true, saved: false });
    expect(await toggleSavedJob(jobId, false)).toEqual({ ok: true, saved: false });
    expect(db.rows.size).toBe(0);
    expect(db.inserts).toHaveLength(1);
  });

  it('inny błąd zapisu nie udaje sukcesu', async () => {
    fakeDb();
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
      from: vi.fn(() => ({
        insert: () =>
          Promise.resolve({ error: { code: '42501', message: 'row-level security' } }),
      })),
    } as never);
    expect(await toggleSavedJob(jobId, true)).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('odrzuca niepoprawny stan docelowy przed połączeniem', async () => {
    expect(await toggleSavedJob(jobId, 'yes' as never)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
