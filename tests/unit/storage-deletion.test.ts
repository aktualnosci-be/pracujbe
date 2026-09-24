import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processStorageDeletions, railwayDeleter, supabaseDeleter } from '@/lib/storage-deletion';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #486 — kolejka usuwania obiektów storage: sukces usuwa wiersz, błąd = ponowienie z kodem.
 * #25: claim i każdy wynik to osobne transakcje service_role (atrapa transakcji).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

function storage(remove: (bucket: string, paths: string[]) => Promise<{ error: unknown }>) {
  const from = vi.fn((bucket: string) => ({ remove: (paths: string[]) => remove(bucket, paths) }));
  return { client: { storage: { from } }, from };
}

function claim(rows: unknown) {
  fakeDb.rpc('claim_storage_deletions', rows).rpc('complete_storage_deletion', null);
}

function completions() {
  return fakeDb.callsTo('complete_storage_deletion').map((call) => call.args);
}

beforeEach(() => {
  resetFakeDb(null);
});

describe('processStorageDeletions', () => {
  it('usuwa obiekty i raportuje wynik każdego wiersza', async () => {
    claim([
      { id: 'q1', bucket: 'candidate-files', path: 'u1/cv-a.pdf' },
      { id: 'q2', bucket: 'candidate-files', path: 'u2/cv-b.pdf' },
      { id: 'q3', bucket: 'candidate-files', path: 'u3/cv-c.pdf' },
    ]);
    const { client } = storage((_bucket, paths) =>
      paths[0] === 'u2/cv-b.pdf'
        ? Promise.resolve({ error: { message: 'Service unavailable at storage.internal' } })
        : paths[0] === 'u3/cv-c.pdf'
          ? Promise.reject(new Error('socket hang up'))
          : Promise.resolve({ error: null }),
    );
    expect(await processStorageDeletions(supabaseDeleter(client), 10)).toEqual({ claimed: 3, deleted: 1, failed: 2 });
    expect(fakeDb.callsTo('claim_storage_deletions')[0]).toMatchObject({ args: { p_limit: 10 }, as: 'service' });
    expect(completions()).toEqual([
      { p_id: 'q1', p_ok: true, p_error: null },
      { p_id: 'q2', p_ok: false, p_error: 'STORAGE_ERROR' },
      { p_id: 'q3', p_ok: false, p_error: 'STORAGE_UNAVAILABLE' },
    ]);
    // Każdy wynik we własnej transakcji service_role (claim zatwierdzony przed usuwaniem).
    expect(fakeDb.callsTo('complete_storage_deletion').every((call) => call.as === 'service')).toBe(true);
  });

  it('błąd pobrania partii przerywa zadanie (503 w maintenance)', async () => {
    fakeDb.rpc('claim_storage_deletions', () => { throw pgError('42501', 'permission denied'); });
    const { client, from } = storage(() => Promise.resolve({ error: null }));
    await expect(processStorageDeletions(supabaseDeleter(client))).rejects.toMatchObject({ message: 'permission denied' });
    expect(from).not.toHaveBeenCalled();
  });

  it('pomija wiersze o nieoczekiwanym kształcie', async () => {
    claim([{ id: 'q1' }, null]);
    const { client, from } = storage(() => Promise.resolve({ error: null }));
    expect(await processStorageDeletions(supabaseDeleter(client))).toEqual({ claimed: 0, deleted: 0, failed: 0 });
    expect(from).not.toHaveBeenCalled();
    expect(completions()).toEqual([]);
  });

  it('bucket Railway: usuwa po kluczu, błąd adaptera = kod bez ścieżki', async () => {
    const del = vi.fn((input: { key: string }) =>
      Promise.resolve(input.key === 'u2/cv-b.pdf' ? { ok: false as const, error: 'UNAVAILABLE' } : { ok: true as const }),
    );
    claim([
      { id: 'q1', bucket: 'candidate-files', path: 'u1/cv-a.pdf' },
      { id: 'q2', bucket: 'candidate-files', path: 'u2/cv-b.pdf' },
    ]);
    expect(await processStorageDeletions(railwayDeleter({ delete: del }))).toEqual({ claimed: 2, deleted: 1, failed: 1 });
    expect(del).toHaveBeenCalledWith({ key: 'u1/cv-a.pdf' });
    expect(completions()).toContainEqual({ p_id: 'q2', p_ok: false, p_error: 'UNAVAILABLE' });
  });
});
