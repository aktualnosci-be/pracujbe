import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/** #98 — retencja zgłoszeń gościa w crona /api/maintenance: licznik i 503 przy błędzie. */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn() }));
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
