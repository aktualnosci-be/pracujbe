import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

/**
 * #17 — dzienny GC bucketu CV na PostgreSQL 16 (migracja 0117) z bucketem w pamięci:
 * obiekt bez wiersza `files` → kolejka usuwania (tylko w trybie delete, po karencji),
 * wiersz bez obiektu → licznik, partie z kursorem, dzienny rytm, dzierżawa, uprawnienia.
 */

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());

const { runStorageGc, CV_FILES_BUCKET } = await import('../../src/lib/storage-gc');
const { processStorageDeletions } = await import('../../src/lib/storage-deletion');

const DAY = 24 * 3_600_000;

/** Bucket w pamięci o semantyce ListObjectsV2 (porządek bajtowy, StartAfter, MaxKeys). */
function memoryBucket(objects: Map<string, Date>) {
  const store = {
    listCalls: 0,
    async list(input: { startAfter?: string | null; maxKeys?: number }) {
      store.listCalls += 1;
      const keys = [...objects.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .filter((key) => !input.startAfter || key > input.startAfter);
      const page = keys.slice(0, input.maxKeys ?? 500);
      const truncated = keys.length > page.length;
      const cv = page.filter((key) => /\/cv-[0-9a-f-]+\.(pdf|doc|docx)$/.test(key));
      return {
        ok: true as const,
        value: {
          objects: cv.map((key) => ({ key, lastModified: objects.get(key) ?? null })),
          foreign: page.length - cv.length,
          nextStartAfter: truncated ? page.at(-1)! : null,
        },
      };
    },
  };
  return store;
}

function db() {
  return realSession.db!;
}

let owner: string;
const cvKey = (id = randomUUID()) => `${owner}/cv-${id}.pdf`;

async function insertFile(path: string, createdAt = new Date(Date.now() - 3 * DAY)) {
  await db().admin.query(
    `INSERT INTO public.files(owner_id, bucket, path, file_name, mime_type, size_bytes, entity_type, created_at)
     VALUES ($1, $2, $3, 'cv.pdf', 'application/pdf', 10, 'candidate_cv', $4)`,
    [owner, CV_FILES_BUCKET, path, createdAt],
  );
}

async function queued(): Promise<string[]> {
  const { rows } = await db().admin.query(`SELECT path FROM public.storage_deletion_queue ORDER BY path`);
  return rows.map((row) => row.path);
}

beforeAll(async () => {
  realSession.db = await startPortalDb();
  owner = await db().createUser('candidate');
}, 180_000);

afterAll(async () => {
  await realSession.db?.stop();
});

beforeEach(async () => {
  await db().admin.query(`DELETE FROM public.storage_gc_sweeps; DELETE FROM public.files; DELETE FROM public.storage_deletion_queue`);
});

describe('GC bucketu CV (#17)', () => {
  it('dry-run: same liczniki, nic w kolejce', async () => {
    const old = new Date(Date.now() - 3 * DAY);
    const withRow = cvKey();
    const orphan = cvKey();
    const fresh = cvKey();
    const objects = new Map([[withRow, old], [orphan, old], [fresh, new Date()], ['exports/raport.csv', old]]);
    await insertFile(withRow);
    await insertFile(cvKey()); // wiersz bez obiektu

    const result = await runStorageGc(memoryBucket(objects), { dryRun: true });
    expect(result).toMatchObject({
      status: 'done', dryRun: true, objectsScanned: 3, foreignObjects: 1, recentObjects: 1,
      orphanObjects: 1, orphanQueued: 0, missingObjects: 1,
    });
    expect(await queued()).toEqual([]);
    // Wynik to same liczby — żaden klucz ani ścieżka.
    expect(JSON.stringify(result)).not.toContain(owner);
  });

  it('tryb delete: tylko stara sierota trafia do kolejki, worker ją usuwa; plik z wierszem i świeży upload zostają', async () => {
    const old = new Date(Date.now() - 3 * DAY);
    const withRow = cvKey();
    const softDeleted = cvKey();
    const orphan = cvKey();
    const fresh = cvKey();
    const objects = new Map([[withRow, old], [softDeleted, old], [orphan, old], [fresh, new Date()]]);
    await insertFile(withRow);
    await insertFile(softDeleted);
    await db().admin.query(`UPDATE public.files SET deleted_at = now() WHERE path = $1`, [softDeleted]);

    expect(await runStorageGc(memoryBucket(objects), { dryRun: false })).toMatchObject({
      status: 'done', orphanObjects: 1, orphanQueued: 1, missingObjects: 0,
    });
    expect(await queued()).toEqual([orphan]);

    const deleted: string[] = [];
    const run = await processStorageDeletions(async (_bucket, path) => {
      deleted.push(path);
      objects.delete(path);
      return null;
    });
    expect(run).toEqual({ claimed: 1, deleted: 1, failed: 0 });
    expect(deleted).toEqual([orphan]);
    expect([...objects.keys()].sort()).toEqual([withRow, softDeleted, fresh].sort());
  });

  it('wiersz files dodany po liście nie zostaje skasowany (claim usuwa pozycję z kolejki)', async () => {
    const orphan = cvKey();
    await runStorageGc(memoryBucket(new Map([[orphan, new Date(Date.now() - 3 * DAY)]])), { dryRun: false });
    expect(await queued()).toEqual([orphan]);
    await insertFile(orphan);
    const deleter = vi.fn(async () => null);
    expect(await processStorageDeletions(deleter)).toEqual({ claimed: 0, deleted: 0, failed: 0 });
    expect(deleter).not.toHaveBeenCalled();
  });

  it('partie: limit stron na wywołanie, kontynuacja od kursora, liczniki całego przebiegu', async () => {
    const old = new Date(Date.now() - 3 * DAY);
    const keys = Array.from({ length: 7 }, () => cvKey()).sort();
    const objects = new Map(keys.map((key) => [key, old] as const));
    for (const key of keys.slice(0, 3)) await insertFile(key);
    // Wiersze bez obiektu na początku, w środku i na końcu zakresu kluczy.
    for (const prefix of ['0', '8', 'f']) {
      await insertFile(`${prefix}${owner.slice(1)}/cv-${randomUUID()}.pdf`);
    }
    const bucket = memoryBucket(objects);

    const first = await runStorageGc(bucket, { dryRun: true, pageSize: 2, maxPages: 2 });
    expect(first).toMatchObject({ status: 'partial', pages: 2, objectsScanned: 4 });
    const second = await runStorageGc(bucket, { dryRun: true, pageSize: 2, maxPages: 10 });
    expect(second).toMatchObject({ status: 'done', pages: 2, objectsScanned: 3 });

    const { rows } = await db().admin.query(
      `SELECT pages, objects_scanned, orphan_objects, missing_objects, cursor_key, finished_at IS NOT NULL AS finished
         FROM public.storage_gc_sweeps`,
    );
    expect(rows).toEqual([{
      pages: 4, objects_scanned: 7, orphan_objects: 4, missing_objects: 3, cursor_key: null, finished: true,
    }]);
  });

  it('dzienny rytm: po zakończonym przebiegu kolejny dopiero po 23 h', async () => {
    const bucket = memoryBucket(new Map());
    expect(await runStorageGc(bucket, { dryRun: true })).toMatchObject({ status: 'done' });
    expect(await runStorageGc(bucket, { dryRun: true })).toEqual({ status: 'not_due' });
    await db().admin.query(`UPDATE public.storage_gc_sweeps SET finished_at = now() - interval '24 hours'`);
    expect(await runStorageGc(bucket, { dryRun: true })).toMatchObject({ status: 'done' });
  });

  it('dzierżawa: drugi równoległy przebieg dostaje busy; zmiana trybu zaczyna od nowa', async () => {
    const objects = new Map(Array.from({ length: 3 }, () => [cvKey(), new Date(Date.now() - 3 * DAY)] as const));
    const bucket = memoryBucket(objects);
    expect(await runStorageGc(bucket, { dryRun: true, pageSize: 1, maxPages: 1 })).toMatchObject({ status: 'partial' });
    // Przebieg częściowy zwalnia dzierżawę; proces przerwany w trakcie strony — nie.
    const { rows: [lease] } = await db().admin.query(`SELECT locked_until FROM public.storage_gc_sweeps`);
    expect(lease.locked_until).toBeNull();
    await db().admin.query(`UPDATE public.storage_gc_sweeps SET locked_until = now() + interval '5 minutes'`);
    expect(await runStorageGc(bucket, { dryRun: true })).toEqual({ status: 'busy' });
    await db().admin.query(`UPDATE public.storage_gc_sweeps SET locked_until = now() - interval '1 second'`);
    // Tryb delete porzuca przebieg dry-run i zaczyna od początku bucketu.
    expect(await runStorageGc(bucket, { dryRun: false })).toMatchObject({
      status: 'done', dryRun: false, objectsScanned: 3, orphanQueued: 3,
    });
  });

  it('ponowienie zatwierdzonej strony (retry po utracie odpowiedzi) = STALE_STATE, bez podwójnego liczenia', async () => {
    const keys = [cvKey(), cvKey()].sort();
    const { rows: [begin] } = await db().service.query(
      `SELECT * FROM public.storage_gc_begin('candidate-files', 23, true)`,
    );
    const page = `SELECT * FROM public.storage_gc_page($1, $2, $3, $3, false)`;
    await db().service.query(page, [begin.sweep_id, keys[0], [keys[0]]]);
    await expect(db().service.query(page, [begin.sweep_id, keys[0], [keys[0]]])).rejects.toThrow('STALE_STATE');
    const { rows } = await db().admin.query(`SELECT objects_scanned FROM public.storage_gc_sweeps`);
    expect(rows).toEqual([{ objects_scanned: 1 }]);
  });

  it('uprawnienia: tylko service_role; tabela niewidoczna dla ról aplikacji', async () => {
    const { rows: [grants] } = await db().admin.query(`SELECT
      has_function_privilege('authenticated', 'public.storage_gc_begin(text, integer, boolean)', 'EXECUTE') AS auth_begin,
      has_function_privilege('anon', 'public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean)', 'EXECUTE') AS anon_page,
      has_table_privilege('authenticated', 'public.storage_gc_sweeps', 'SELECT') AS auth_select,
      has_function_privilege('service_role', 'public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean)', 'EXECUTE') AS service_page`);
    expect(grants).toEqual({ auth_begin: false, anon_page: false, auth_select: false, service_page: true });
    await expect(db().web.query(`SELECT * FROM public.storage_gc_begin('candidate-files', 23, false)`))
      .rejects.toThrow(/permission denied/);
  });

  it('kontrola ujemna: naiwne kolejkowanie wszystkich starych kluczy skasowałoby plik z wierszem', async () => {
    const withRow = cvKey();
    await insertFile(withRow);
    const client = await db().admin.connect();
    try {
      await client.query('BEGIN');
      // Wariant bez warunku NOT EXISTS files — dokładnie to, przed czym chroni storage_gc_page.
      await client.query(
        `INSERT INTO public.storage_deletion_queue(bucket, path) SELECT $1, k FROM unnest($2::text[]) k`,
        [CV_FILES_BUCKET, [withRow]],
      );
      const { rows } = await client.query(`SELECT path FROM public.storage_deletion_queue`);
      expect(rows.map((row) => row.path)).toContain(withRow);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // Prawdziwy GC tego samego stanu: nic w kolejce.
    await runStorageGc(memoryBucket(new Map([[withRow, new Date(Date.now() - 3 * DAY)]])), { dryRun: false });
    expect(await queued()).toEqual([]);
  });
});
