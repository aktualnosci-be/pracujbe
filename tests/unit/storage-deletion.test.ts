import { describe, expect, it, vi } from 'vitest';

import { processStorageDeletions, railwayDeleter, supabaseDeleter } from '@/lib/storage-deletion';

/** #486 — kolejka usuwania obiektów storage: sukces usuwa wiersz, błąd = ponowienie z kodem. */

function admin(rows: unknown, remove: (bucket: string, paths: string[]) => Promise<{ error: unknown }>) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(name === 'claim_storage_deletions' ? { data: rows, error: null } : { data: null, error: null }),
  );
  const from = vi.fn((bucket: string) => ({ remove: (paths: string[]) => remove(bucket, paths) }));
  return { client: { rpc, storage: { from } } as never, rpc, from };
}

describe('processStorageDeletions', () => {
  it('usuwa obiekty i raportuje wynik każdego wiersza', async () => {
    const rows = [
      { id: 'q1', bucket: 'candidate-files', path: 'u1/cv-a.pdf' },
      { id: 'q2', bucket: 'candidate-files', path: 'u2/cv-b.pdf' },
      { id: 'q3', bucket: 'candidate-files', path: 'u3/cv-c.pdf' },
    ];
    const { client, rpc } = admin(rows, (_bucket, paths) =>
      paths[0] === 'u2/cv-b.pdf'
        ? Promise.resolve({ error: { message: 'Service unavailable at storage.internal' } })
        : paths[0] === 'u3/cv-c.pdf'
          ? Promise.reject(new Error('socket hang up'))
          : Promise.resolve({ error: null }),
    );
    expect(await processStorageDeletions(client, supabaseDeleter(client), 10)).toEqual({ claimed: 3, deleted: 1, failed: 2 });
    expect(rpc).toHaveBeenCalledWith('claim_storage_deletions', { p_limit: 10 });
    expect(rpc).toHaveBeenCalledWith('complete_storage_deletion', { p_id: 'q1', p_ok: true, p_error: null });
    expect(rpc).toHaveBeenCalledWith('complete_storage_deletion', { p_id: 'q2', p_ok: false, p_error: 'STORAGE_ERROR' });
    expect(rpc).toHaveBeenCalledWith('complete_storage_deletion', {
      p_id: 'q3',
      p_ok: false,
      p_error: 'STORAGE_UNAVAILABLE',
    });
  });

  it('błąd pobrania partii przerywa zadanie (503 w maintenance)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(processStorageDeletions({ rpc } as never)).rejects.toMatchObject({ message: 'permission denied' });
  });

  it('pomija wiersze o nieoczekiwanym kształcie', async () => {
    const { client, from } = admin([{ id: 'q1' }, null], () => Promise.resolve({ error: null }));
    expect(await processStorageDeletions(client)).toEqual({ claimed: 0, deleted: 0, failed: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it('bucket Railway: usuwa po kluczu, błąd adaptera = kod bez ścieżki', async () => {
    const del = vi.fn((input: { key: string }) =>
      Promise.resolve(input.key === 'u2/cv-b.pdf' ? { ok: false as const, error: 'UNAVAILABLE' } : { ok: true as const }),
    );
    const rows = [
      { id: 'q1', bucket: 'candidate-files', path: 'u1/cv-a.pdf' },
      { id: 'q2', bucket: 'candidate-files', path: 'u2/cv-b.pdf' },
    ];
    const { client, rpc, from } = admin(rows, () => Promise.resolve({ error: null }));
    expect(await processStorageDeletions(client, railwayDeleter({ delete: del }))).toEqual({ claimed: 2, deleted: 1, failed: 1 });
    expect(del).toHaveBeenCalledWith({ key: 'u1/cv-a.pdf' });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('complete_storage_deletion', { p_id: 'q2', p_ok: false, p_error: 'UNAVAILABLE' });
  });
});
