import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { rpcRows } from '@/lib/db/sql';
import type { createRailwayBucket } from '@/lib/storage/railway-bucket';

/**
 * Dzienny GC prywatnego bucketu CV (#17, migracja 0108).
 *
 * Przebieg porównuje listę obiektów bucketu z wierszami `files` partiami (strona listy =
 * jedna krótka transakcja `storage_gc_page`, kursor w bazie):
 *   - obiekt bez wiersza `files`, starszy niż karencja (upload w toku) → `storage_deletion_queue`
 *     (0105); usuwa go worker `processStorageDeletions` z ponowieniami. Dry-run = tylko liczniki.
 *   - wiersz `files` bez obiektu → tylko licznik (wiersza nie kasujemy — decyzja człowieka).
 * Nowy przebieg najwcześniej 23 h po poprzednim (dzienny rytm przy cronie co godzinę);
 * przebieg przerwany limitem stron albo awarią jest kontynuowany w kolejnym wywołaniu.
 *
 * Tryb: dry-run domyślnie. Kasowanie wymaga jawnego `STORAGE_GC_MODE=delete` (produkcyjne
 * kasowanie danych = osobne zatwierdzenie, #17). Wynik i logi zawierają tylko liczniki —
 * nigdy klucz obiektu, ścieżkę ani nazwę pliku.
 */

/** Nazwa bucketu w `files.bucket` dla CV (niezależna od nazwy bucketu Railway). */
export const CV_FILES_BUCKET = 'candidate-files';

export type StorageGcStore = Pick<ReturnType<typeof createRailwayBucket>, 'list'>;

export interface StorageGcOptions {
  dryRun: boolean;
  /** Obiekty młodsze niż karencja nie są sierotami (upload → INSERT w toku). */
  graceHours?: number;
  pageSize?: number;
  /** Limit stron na jedno wywołanie (reszta w kolejnym przebiegu crona). */
  maxPages?: number;
  minIntervalHours?: number;
  now?: () => Date;
}

export type StorageGcRun =
  | { status: 'not_due' | 'busy' }
  | {
      status: 'done' | 'partial';
      dryRun: boolean;
      pages: number;
      objectsScanned: number;
      foreignObjects: number;
      recentObjects: number;
      orphanObjects: number;
      orphanQueued: number;
      missingObjects: number;
    };

/** Tryb z env: kasowanie tylko przy dokładnym `delete`, wszystko inne = dry-run. */
export function storageGcDryRun(env: Record<string, string | undefined> = process.env): boolean {
  return env.STORAGE_GC_MODE?.trim() !== 'delete';
}

/** Błąd GC niosący sam kod (bez ścieżek, bez komunikatu dostawcy). */
export class StorageGcError extends Error {
  constructor(readonly code: string) {
    super(`STORAGE_GC_${code}`);
    this.name = 'StorageGcError';
  }
}

function int(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function runStorageGc(store: StorageGcStore, options: StorageGcOptions): Promise<StorageGcRun> {
  const graceHours = options.graceHours ?? 24;
  const pageSize = options.pageSize ?? 500;
  const maxPages = options.maxPages ?? 20;
  const now = options.now ?? (() => new Date());

  const [begin] = await withServiceRole((tx) =>
    rpcRows<{ status: string; sweep_id: string | null; cursor_key: string | null }>(tx, 'storage_gc_begin', {
      p_bucket: CV_FILES_BUCKET,
      p_min_interval_hours: options.minIntervalHours ?? 23,
      p_dry_run: options.dryRun,
    }));
  if (!begin || begin.status === 'not_due' || begin.status === 'busy') {
    return { status: begin?.status === 'busy' ? 'busy' : 'not_due' };
  }
  const sweepId = begin.sweep_id;
  if (typeof sweepId !== 'string') throw new StorageGcError('BEGIN');

  const totals = {
    pages: 0,
    objectsScanned: 0,
    foreignObjects: 0,
    recentObjects: 0,
    orphanObjects: 0,
    orphanQueued: 0,
    missingObjects: 0,
  };
  let cursor = begin.cursor_key;
  let finished = false;

  while (totals.pages < maxPages) {
    const page = await store.list({ startAfter: cursor, maxKeys: pageSize });
    if (!page.ok) throw new StorageGcError(page.error);
    const threshold = now().getTime() - graceHours * 3_600_000;
    const keys = page.value.objects.map((object) => object.key);
    // Brak daty modyfikacji = nie wiemy, czy upload się skończył → nie jest sierotą.
    const oldKeys = page.value.objects
      .filter((object) => object.lastModified !== null && object.lastModified.getTime() < threshold)
      .map((object) => object.key);
    const final = page.value.nextStartAfter === null;
    const lastKey = final ? null : page.value.nextStartAfter;

    const [counts] = await withServiceRole((tx) =>
      rpcRows<{ orphan_objects: number; orphan_queued: number; missing_objects: number }>(tx, 'storage_gc_page', {
        p_sweep_id: sweepId,
        p_last_key: lastKey,
        p_keys: keys,
        p_old_keys: oldKeys,
        p_final: final,
        p_grace_hours: graceHours,
        // Ostatnia strona tego wywołania: zwolnij dzierżawę (kolejny cron kontynuuje od kursora).
        p_release: totals.pages + 1 >= maxPages,
      }));

    totals.pages += 1;
    totals.objectsScanned += keys.length;
    totals.foreignObjects += page.value.foreign;
    totals.recentObjects += keys.length - oldKeys.length;
    totals.orphanObjects += int(counts?.orphan_objects);
    totals.orphanQueued += int(counts?.orphan_queued);
    totals.missingObjects += int(counts?.missing_objects);

    if (final) {
      finished = true;
      break;
    }
    cursor = lastKey;
  }

  return { status: finished ? 'done' : 'partial', dryRun: options.dryRun, ...totals };
}
