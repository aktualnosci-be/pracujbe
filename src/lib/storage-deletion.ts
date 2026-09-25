import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { rpc, rpcRows } from '@/lib/db/sql';

/**
 * Worker kolejki usuwania obiektów storage (#486, `storage_deletion_queue`, 0105).
 *
 * Wiersz kolejki powstaje triggerem po KAŻDYM usunięciu wiersza `files` (akcja kandydata,
 * usunięcie konta, retencja) — obiekt nie zostaje osierocony, nawet gdy natychmiastowe
 * usunięcie w akcji się nie powiodło. Worker bierze partię (`claim_storage_deletions`:
 * SKIP LOCKED + dzierżawa 5 min), usuwa obiekty przez service-role i raportuje wynik
 * (`complete_storage_deletion`): sukces usuwa wiersz, błąd = ponowienie z backoffem.
 * #25: claim i każdy wynik to osobne, krótkie transakcje service_role (pula `service`) —
 * dzierżawa jest zatwierdzona przed usuwaniem obiektów, a żadna transakcja nie trwa podczas
 * wywołania storage.
 * Brak obiektu w storage to sukces (usuwanie idempotentne). Do logów trafia tylko kod błędu —
 * nigdy ścieżka obiektu ani URL.
 *
 * Obiekty usuwa `ObjectDeleter`: prywatny bucket Railway (#26). Bez jego konfiguracji każdy
 * wiersz kończy się błędem `STORAGE_UNCONFIGURED` i wraca do kolejki z backoffem.
 */

/** Usunięcie jednego obiektu; `null` = sukces, inaczej krótki kod błędu (bez ścieżki). */
export type ObjectDeleter = (bucket: string, path: string) => Promise<string | null>;

/** Bez bucketu: obiekt nie może zostać usunięty — wiersz zostaje w kolejce (ponowienie). */
export const unconfiguredDeleter: ObjectDeleter = async () => 'STORAGE_UNCONFIGURED';

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
  deleteObject: ObjectDeleter,
  limit = 50,
): Promise<StorageDeletionRun> {
  const rows = asRows(
    await withServiceRole((tx) => rpcRows(tx, 'claim_storage_deletions', { p_limit: limit })),
  );
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
    await withServiceRole((tx) =>
      rpc(tx, 'complete_storage_deletion', { p_id: row.id, p_ok: ok, p_error: code }));
    if (ok) deleted += 1;
    else failed += 1;
  }
  return { claimed: rows.length, deleted, failed };
}
