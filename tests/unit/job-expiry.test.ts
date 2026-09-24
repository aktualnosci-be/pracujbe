// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { effectiveJobStatus, isPastExpiry, notExpiredFilter } from '@/lib/job-expiry';

vi.mock('@/lib/env', () => ({ hasServiceRoleKey: vi.fn(), isProductionMode: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/jobs', () => ({ setJobStatus: vi.fn() }));

import { hasServiceRoleKey, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createAdminClient } from '@/lib/supabase/admin';
import { allowedActions } from '@/components/employer/JobLifecycleActions';
import { POST } from '@/app/api/maintenance/route';

const NOW = new Date('2026-09-24T12:00:00.000Z');

describe('wygaszanie ofert w panelu (#72)', () => {
  it('granica expires_at = now jest już po terminie; przyszła data i brak daty nie', () => {
    expect(isPastExpiry('2026-09-24T12:00:00.000Z', NOW)).toBe(true);
    expect(isPastExpiry('2026-09-24T11:59:59.000Z', NOW)).toBe(true);
    expect(isPastExpiry('2026-09-24T12:00:00.001Z', NOW)).toBe(false);
    expect(isPastExpiry(null, NOW)).toBe(false);
    expect(isPastExpiry('', NOW)).toBe(false);
    expect(isPastExpiry('nie-data', NOW)).toBe(false);
  });

  it('tylko aktywna po terminie jest pokazywana jako expired', () => {
    const past = '2026-09-01T00:00:00Z';
    expect(effectiveJobStatus('active', past, NOW)).toBe('expired');
    expect(effectiveJobStatus('active', '2026-10-01T00:00:00Z', NOW)).toBe('active');
    expect(effectiveJobStatus('active', null, NOW)).toBe('active');
    for (const status of ['draft', 'paused', 'closed', 'expired']) {
      expect(effectiveJobStatus(status, past, NOW)).toBe(status);
    }
  });

  it('filtr licznika aktywnych = predykat bazy (brak daty lub data przyszła)', () => {
    expect(notExpiredFilter(NOW)).toBe('expires_at.is.null,expires_at.gt.2026-09-24T12:00:00.000Z');
  });

  it('wygasła i wstrzymana po terminie proponują ponowne otwarcie, nie wznowienie', () => {
    expect(allowedActions('expired')).toEqual(['reopen']);
    expect(allowedActions('paused', true)).toEqual(['reopen', 'close']);
    // Kontrola ujemna: wstrzymana przed terminem nadal się wznawia.
    expect(allowedActions('paused', false)).toEqual(['resume', 'close']);
    expect(allowedActions('active')).toEqual(['pause', 'close']);
  });
});

describe('/api/maintenance — expire_due_jobs (#72)', () => {
  const request = (auth?: string) =>
    new Request('http://web.internal/api/maintenance', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
    });
  const rpc = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.MAINTENANCE_SECRET = 'maintenance-secret';
    delete process.env.CRON_SECRET;
    vi.mocked(hasServiceRoleKey).mockReturnValue(true);
    vi.mocked(isProductionMode).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  });

  it('bez sekretu → 401 i brak wywołań bazy', async () => {
    const res = await POST(request('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('wywołuje expire_due_jobs i zwraca wyłącznie liczniki', async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve({ data: name === 'expire_due_jobs' ? 3 : 0, error: null }),
    );
    const res = await POST(request('Bearer maintenance-secret'));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('expire_due_jobs');
    expect(await res.json()).toEqual({
      ok: true,
      releasedDiscounts: 0,
      releasedCheckouts: 0,
      expiredJobs: 3,
      savedSearchDigests: 0,
      purgedGuestRequests: 0,
      campaignEmailsQueued: 0,
      retention: {},
      storageDeletions: { claimed: 0, deleted: 0, failed: 0 },
    });
  });

  it('błąd wygaszania → 503 bez pozornego sukcesu i bez szczegółów w odpowiedzi', async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'expire_due_jobs'
          ? { data: null, error: { message: 'permission denied for function expire_due_jobs' } }
          : { data: 0, error: null },
      ),
    );
    const res = await POST(request('Bearer maintenance-secret'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'gc failed' });
    expect(JSON.stringify(body)).not.toContain('maintenance-secret');
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      area: 'maintenance.gc',
      task: 'jobExpiry',
    });
  });
});
