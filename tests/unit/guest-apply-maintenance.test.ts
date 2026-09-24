import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/maintenance/route';
import { hasServiceRoleKey, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createAdminClient } from '@/lib/supabase/admin';

/** #98 — retencja zgłoszeń gościa w crona /api/maintenance: licznik i 503 przy błędzie. */

vi.mock('@/lib/env', () => ({ hasServiceRoleKey: vi.fn(), isProductionMode: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const rpc = vi.fn();
const request = () =>
  new Request('http://web.internal/api/maintenance', {
    method: 'POST',
    headers: { authorization: 'Bearer maintenance-secret' },
  });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.MAINTENANCE_SECRET = 'maintenance-secret';
  vi.mocked(hasServiceRoleKey).mockReturnValue(true);
  vi.mocked(isProductionMode).mockReturnValue(true);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
});

describe('maintenance: guest application retention', () => {
  it('purges and reports only the count', async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve({ data: name === 'purge_guest_application_requests' ? 4 : 0, error: null }),
    );
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('purge_guest_application_requests');
    expect(await res.json()).toMatchObject({ ok: true, purgedGuestRequests: 4 });
  });

  it('purge failure → 503 without a fake success', async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'purge_guest_application_requests'
          ? { data: null, error: { message: 'permission denied' } }
          : { data: 0, error: null },
      ),
    );
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'gc failed' });
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'guestRequests' });
  });
});
