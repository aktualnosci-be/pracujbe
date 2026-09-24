import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Worker kolejki usuwania obiektów storage (#486, `storage_deletion_queue`, 0104).
 *
 * Wiersz kolejki powstaje triggerem po KAŻDYM usunięciu wiersza `files` (akcja kandydata,
 * usunięcie konta, retencja) — obiekt nie zostaje osierocony, nawet gdy natychmiastowe
 * usunięcie w akcji się nie powiodło. Worker bierze partię (`claim_storage_deletions`:
 * SKIP LOCKED + dzierżawa 5 min), usuwa obiekty przez service-role i raportuje wynik
 * (`complete_storage_deletion`): sukces usuwa wiersz, błąd = ponowienie z backoffem.
 * Brak obiektu w storage to sukces (usuwanie idempotentne). Do logów trafia tylko kod błędu —
 * nigdy ścieżka obiektu ani URL.
 *
 * Obiekty usuwa `ObjectDeleter`: prywatny bucket Railway (#26), gdy jest skonfigurowany, inaczej
 * Supabase Storage (przejściowo, `supabaseDeleter`).
 */

/** Usunięcie jednego obiektu; `null` = sukces, inaczej krótki kod błędu (bez ścieżki). */
export type ObjectDeleter = (bucket: string, path: string) => Promise<string | null>;

export function supabaseDeleter(admin: SupabaseClient): ObjectDeleter {
  return async (bucket, path) => {
    const result = await admin.storage.from(bucket).remove([path]);
    return result.error ? 'STORAGE_ERROR' : null;
  };
}

/** Bucket Railway ma jedną nazwę z konfiguracji; wiersze CV mają w `files.bucket` 'candidate-files'. */
export function railwayDeleter(
  store: { delete(input: { key: string }): Promise<{ ok: true } | { ok: false; error: string }> },
): ObjectDeleter {
  return async (_bucket, path) => {
    const result = await store.delete({ key: path });
    return result.ok ? null : result.error;
  };
}

export interface StorageDeletionRun {
  claimed: number;
  deleted: number;
  failed: number;
}

interface ClaimedRow {
  id: string;
  bucket: string;
  path: string;
}

function asRows(value: unknown): ClaimedRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const r = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
    return typeof r.id === 'string' && typeof r.bucket === 'string' && typeof r.path === 'string'
      ? [{ id: r.id, bucket: r.bucket, path: r.path }]
      : [];
  });
}

export async function processStorageDeletions(
  admin: SupabaseClient,
  deleteObject: ObjectDeleter = supabaseDeleter(admin),
  limit = 50,
): Promise<StorageDeletionRun> {
  const { data, error } = await admin.rpc('claim_storage_deletions', { p_limit: limit });
  if (error) throw error;
  const rows = asRows(data);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    let code: string | null;
    try {
      code = await deleteObject(row.bucket, row.path);
    } catch {
      code = 'STORAGE_UNAVAILABLE';
    }
    const ok = code === null;
    const done = await admin.rpc('complete_storage_deletion', { p_id: row.id, p_ok: ok, p_error: code });
    if (done.error) throw done.error;
    if (ok) deleted += 1;
    else failed += 1;
  }
  return { claimed: rows.length, deleted, failed };
}
