import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * #17 — GC bucketu CV: tryb (dry-run domyślnie), karencja, partie, kody błędów bez ścieżek,
 * wpięcie w /api/maintenance (przed workerem kolejki, 503 przy awarii listy).
 * SQL (kolejka, kursor, liczniki, uprawnienia) sprawdza `tests/integration/storage-gc.test.ts`.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
const bucket = vi.hoisted(() => ({ config: null as unknown, store: null as unknown }));
vi.mock('@/lib/env', () => ({ isProductionMode: () => true, fileBucketConfig: () => bucket.config }));
vi.mock('@/lib/storage/railway-bucket', () => ({ createRailwayBucket: () => bucket.store }));

const { runStorageGc, storageGcDryRun, StorageGcError } = await import('@/lib/storage-gc');
const { POST } = await import('@/app/api/maintenance/route');
const { captureError } = await import('@/lib/error-report');

const OWNER = '11111111-1111-4111-8111-111111111111';
const key = (n: number) => `${OWNER}/cv-${String(n).padStart(8, '0')}-2222-4222-8222-222222222222.pdf`;
const NOW = new Date('2026-09-25T02:30:00Z');
const OLD = new Date(NOW.getTime() - 48 * 3_600_000);
const FRESH = new Date(NOW.getTime() - 3_600_000);

type Page = { objects: Array<{ key: string; lastModified: Date | null }>; foreign: number; nextStartAfter: string | null };

function store(pages: Page[]) {
  const list = vi.fn(async (_input: { startAfter?: string | null; maxKeys?: number }) => {
    const page = pages.shift();
    return page ? { ok: true as const, value: page } : { ok: false as const, error: 'UNAVAILABLE' as const, retryable: true };
  });
  return { list };
}

function begin(status: string, cursor: string | null = null) {
  fakeDb.rpc('storage_gc_begin', [{ status, sweep_id: status === 'not_due' ? null : 'sweep-1', cursor_key: cursor }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
  fakeDb.rpc('storage_gc_page', [{ orphan_objects: 1, orphan_queued: 0, missing_objects: 2 }]);
});

describe('storageGcDryRun', () => {
  it('kasowanie tylko przy dokładnym STORAGE_GC_MODE=delete', () => {
    expect(storageGcDryRun({})).toBe(true);
    expect(storageGcDryRun({ STORAGE_GC_MODE: 'dry-run' })).toBe(true);
    expect(storageGcDryRun({ STORAGE_GC_MODE: 'DELETE' })).toBe(true);
    expect(storageGcDryRun({ STORAGE_GC_MODE: 'true' })).toBe(true);
    expect(storageGcDryRun({ STORAGE_GC_MODE: 'delete' })).toBe(false);
  });
});

describe('runStorageGc', () => {
  it('karencja: świeży upload i brak daty modyfikacji nie są sierotami', async () => {
    begin('started');
    const s = store([{
      objects: [{ key: key(1), lastModified: OLD }, { key: key(2), lastModified: FRESH }, { key: key(3), lastModified: null }],
      foreign: 1,
      nextStartAfter: null,
    }]);
    const result = await runStorageGc(s, { dryRun: true, now: () => NOW });
    expect(fakeDb.callsTo('storage_gc_begin')[0]).toMatchObject({
      as: 'service', args: { p_bucket: 'candidate-files', p_min_interval_hours: 23, p_dry_run: true },
    });
    expect(fakeDb.callsTo('storage_gc_page')[0]).toMatchObject({
      as: 'service',
      args: {
        p_sweep_id: 'sweep-1', p_last_key: null, p_final: true, p_grace_hours: 24,
        p_keys: [key(1), key(2), key(3)], p_old_keys: [key(1)],
      },
    });
    expect(result).toEqual({
      status: 'done', dryRun: true, pages: 1, objectsScanned: 3, foreignObjects: 1, recentObjects: 2,
      orphanObjects: 1, orphanQueued: 0, missingObjects: 2,
    });
  });

  it('kontrola ujemna: bez karencji świeży upload trafiłby do sierot', async () => {
    begin('started');
    await runStorageGc(store([{ objects: [{ key: key(2), lastModified: FRESH }], foreign: 0, nextStartAfter: null }]),
      { dryRun: true, now: () => NOW, graceHours: 0 });
    expect(fakeDb.callsTo('storage_gc_page')[0]!.args.p_old_keys).toEqual([key(2)]);
  });

  it('partie: kontynuacja od kursora, limit stron zwalnia dzierżawę na ostatniej stronie', async () => {
    begin('continue', key(0));
    const s = store([
      { objects: [{ key: key(1), lastModified: OLD }], foreign: 0, nextStartAfter: key(1) },
      { objects: [{ key: key(2), lastModified: OLD }], foreign: 0, nextStartAfter: key(2) },
      { objects: [{ key: key(3), lastModified: OLD }], foreign: 0, nextStartAfter: null },
    ]);
    const result = await runStorageGc(s, { dryRun: false, now: () => NOW, pageSize: 1, maxPages: 2 });
    expect(s.list.mock.calls.map(([input]) => input)).toEqual([
      { startAfter: key(0), maxKeys: 1 },
      { startAfter: key(1), maxKeys: 1 },
    ]);
    expect(fakeDb.callsTo('storage_gc_page').map((call) => [call.args.p_last_key, call.args.p_final, call.args.p_release]))
      .toEqual([[key(1), false, false], [key(2), false, true]]);
    expect(result).toMatchObject({ status: 'partial', dryRun: false, pages: 2 });
  });

  it('not_due i busy: bez listy bucketu', async () => {
    const s = store([]);
    begin('not_due');
    expect(await runStorageGc(s, { dryRun: true })).toEqual({ status: 'not_due' });
    resetFakeDb(null);
    begin('busy');
    expect(await runStorageGc(s, { dryRun: true })).toEqual({ status: 'busy' });
    expect(s.list).not.toHaveBeenCalled();
  });

  it('błąd listy: sam kod, bez zapisu strony', async () => {
    begin('started');
    const error = await runStorageGc(store([]), { dryRun: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageGcError);
    expect((error as Error).message).toBe('STORAGE_GC_UNAVAILABLE');
    expect(fakeDb.callsTo('storage_gc_page')).toHaveLength(0);
  });
});

describe('/api/maintenance + GC (#17)', () => {
  const MAINTENANCE_RPCS = [
    'release_stale_discount_reservations', 'release_stale_checkout_intents',
    'ai_budget_release_stale_reservations', 'expire_due_jobs', 'match_recompute_claim',
    'purge_guest_application_requests', 'process_saved_search_alerts', 'process_email_campaigns',
    'run_retention_purge',
    'purge_job_funnel_data',
    'purge_stale_message_attachments',
  ];
  const request = () => new Request('http://web.internal/api/maintenance', {
    method: 'POST', headers: { authorization: 'Bearer maintenance-secret' },
  });

  beforeEach(() => {
    process.env.MAINTENANCE_SECRET = 'maintenance-secret';
    delete process.env.STORAGE_GC_MODE;
    for (const fn of MAINTENANCE_RPCS) fakeDb.rpc(fn, 0);
    fakeDb.rpc('claim_storage_deletions', []);
    bucket.config = { endpoint: 'https://storage.example.com', bucket: 'b', region: 'auto', accessKeyId: 'a', secretAccessKey: 's' };
  });

  it('GC w dry-run przed kolejką usuwania; odpowiedź i logi bez kluczy obiektów', async () => {
    begin('started');
    bucket.store = { ...store([{ objects: [{ key: key(1), lastModified: OLD }], foreign: 0, nextStartAfter: null }]), delete: vi.fn() };
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storageGc).toMatchObject({ status: 'done', dryRun: true, orphanObjects: 1, missingObjects: 2 });
    const names = fakeDb.calls.map((call) => call.name);
    expect(names.indexOf('storage_gc_page')).toBeLessThan(names.indexOf('claim_storage_deletions'));
    expect(fakeDb.callsTo('storage_gc_begin')[0]!.args.p_dry_run).toBe(true);
    const printed = JSON.stringify([body, log.mock.calls, error.mock.calls]);
    expect(printed).not.toContain(OWNER);
  });

  it('STORAGE_GC_MODE=delete przekazuje tryb kasowania', async () => {
    process.env.STORAGE_GC_MODE = 'delete';
    begin('started');
    bucket.store = { ...store([{ objects: [], foreign: 0, nextStartAfter: null }]), delete: vi.fn() };
    expect((await POST(request())).status).toBe(200);
    expect(fakeDb.callsTo('storage_gc_begin')[0]!.args.p_dry_run).toBe(false);
  });

  it('awaria listy bucketu → 503 z zadaniem storageGc; kolejka usuwania mimo to przetworzona', async () => {
    begin('started');
    bucket.store = { ...store([]), delete: vi.fn() };
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'gc failed' });
    expect(captureError).toHaveBeenCalledWith(expect.any(StorageGcError), { area: 'maintenance.gc', task: 'storageGc' });
    expect(fakeDb.callsTo('claim_storage_deletions')).toHaveLength(1);
  });

  it('bez bucketu Railway GC pominięty (storageGc: null)', async () => {
    bucket.config = null;
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect((await res.json()).storageGc).toBeNull();
    expect(fakeDb.callsTo('storage_gc_begin')).toHaveLength(0);
  });
});
