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
 */

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
  limit = 50,
): Promise<StorageDeletionRun> {
  const { data, error } = await admin.rpc('claim_storage_deletions', { p_limit: limit });
  if (error) throw error;
  const rows = asRows(data);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    let ok = false;
    let code: string | null = null;
    try {
      const result = await admin.storage.from(row.bucket).remove([row.path]);
      ok = !result.error;
      if (result.error) code = 'STORAGE_ERROR';
    } catch {
      code = 'STORAGE_UNAVAILABLE';
    }
    const done = await admin.rpc('complete_storage_deletion', { p_id: row.id, p_ok: ok, p_error: code });
    if (done.error) throw done.error;
    if (ok) deleted += 1;
    else failed += 1;
  }
  return { claimed: rows.length, deleted, failed };
}
