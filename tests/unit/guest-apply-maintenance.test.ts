import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/** #98 — retencja zgłoszeń gościa w crona /api/maintenance: licznik i 503 przy błędzie. */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(), fileBucketConfig: () => null }));
// Bez bucketu Railway kolejka storage używa (przejściowo) klienta Storage Supabase.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => ({ remove: async () => ({ error: null }) }) } }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const { POST } = await import('@/app/api/maintenance/route');
const { isProductionMode } = await import('@/lib/env');
const { captureError } = await import('@/lib/sentry');

const MAINTENANCE_RPCS = [
  'release_stale_discount_reservations',
  'release_stale_checkout_intents',
  'expire_due_jobs',
  'purge_guest_application_requests',
  'process_saved_search_alerts',
  'process_email_campaigns',
  'run_retention_purge',
  'purge_stale_message_attachments',
  'claim_storage_deletions',
];

const request = () =>
  new Request('http://web.internal/api/maintenance', {
    method: 'POST',
    headers: { authorization: 'Bearer maintenance-secret' },
  });

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb(null);
  process.env.MAINTENANCE_SECRET = 'maintenance-secret';
  vi.mocked(isProductionMode).mockReturnValue(true);
  for (const fn of MAINTENANCE_RPCS) fakeDb.rpc(fn, 0);
});

describe('maintenance: guest application retention', () => {
  it('purges and reports only the count (service_role)', async () => {
    fakeDb.rpc('purge_guest_application_requests', 4);
    const res = await POST(request());
    expect(res.status).toBe(200);
    const [call] = fakeDb.callsTo('purge_guest_application_requests');
    expect(call).toMatchObject({ args: {}, as: 'service' });
    expect(await res.json()).toMatchObject({ ok: true, purgedGuestRequests: 4 });
  });

  it('purge failure → 503 without a fake success', async () => {
    fakeDb.rpc('purge_guest_application_requests', () => {
      throw pgError('42501', 'permission denied');
    });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'gc failed' });
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'guestRequests' });
  });

  it('brak puli service: produkcja → 503, poza produkcją → pominięcie bez zapytań', async () => {
    resetFakeDb(null).rpc('expire_due_jobs', 0);
    const { fakeSession } = await import('../helpers/fake-db');
    fakeSession.serviceConfigured = false;
    expect((await POST(request())).status).toBe(503);
    vi.mocked(isProductionMode).mockReturnValue(false);
    const res = await POST(request());
    expect(await res.json()).toEqual({ ok: true, skipped: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('maintenance: retencja danych i kolejka storage (#486)', () => {
  it('zwraca liczniki retencji i kolejki storage', async () => {
    fakeDb
      .rpc('run_retention_purge', { deletedFiles: 2, erasedProfiles: 1, note: 'x' })
      .rpc('claim_storage_deletions', []);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('run_retention_purge')[0]).toMatchObject({ args: { p_limit: 200 }, as: 'service' });
    expect(await res.json()).toMatchObject({
      retention: { deletedFiles: 2, erasedProfiles: 1 },
      storageDeletions: { claimed: 0, deleted: 0, failed: 0 },
    });
  });

  it('błąd retencji → 503', async () => {
    fakeDb.rpc('run_retention_purge', () => { throw pgError('XX000', 'x'); });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'retention' });
  });

  it('błąd kolejki storage → 503', async () => {
    fakeDb.rpc('claim_storage_deletions', () => { throw pgError('XX000', 'x'); });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'storageDeletions' });
  });
});

describe('maintenance: kolejka storage bez bucketu i bez klienta Storage (#25)', () => {
  it('pusta kolejka nie tworzy klienta Storage; błąd klienta = ponowienie wiersza, nie 503', async () => {
    const admin = await import('@/lib/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('supabase_admin_env_missing');
    });
    expect((await POST(request())).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();

    fakeDb
      .rpc('claim_storage_deletions', [{ id: 'q1', bucket: 'candidate-files', path: 'u1/cv.pdf' }])
      .rpc('complete_storage_deletion', null);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ storageDeletions: { claimed: 1, deleted: 0, failed: 1 } });
    expect(fakeDb.callsTo('complete_storage_deletion')[0]?.args).toEqual({ p_id: 'q1', p_ok: false, p_error: 'STORAGE_UNAVAILABLE' });
  });
});
