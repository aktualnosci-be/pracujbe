// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { effectiveJobStatus, isPastExpiry } from '@/lib/job-expiry';

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(), fileBucketConfig: () => null }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/jobs', () => ({ setJobStatus: vi.fn() }));

import { isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
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
  const TASKS = [
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

  beforeEach(() => {
    vi.resetAllMocks();
    resetFakeDb(null);
    for (const fn of TASKS) fakeDb.rpc(fn, 0);
    fakeDb.rpc('claim_storage_deletions', []);
    process.env.MAINTENANCE_SECRET = 'maintenance-secret';
    delete process.env.CRON_SECRET;
    vi.mocked(isProductionMode).mockReturnValue(true);
  });

  it('bez sekretu → 401 i brak wywołań bazy', async () => {
    const res = await POST(request('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('wywołuje expire_due_jobs i zwraca wyłącznie liczniki', async () => {
    fakeDb.rpc('expire_due_jobs', 3);
    const res = await POST(request('Bearer maintenance-secret'));
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('expire_due_jobs')).toEqual([expect.objectContaining({ args: {}, as: 'service' })]);
    // Każde zadanie po kolei, alerty po wygaszeniu ofert (alert nie zgłosi właśnie wygasłej).
    expect(fakeDb.calls.map((c) => c.name)).toEqual(TASKS);
    expect(await res.json()).toEqual({
      ok: true,
      releasedDiscounts: 0,
      releasedCheckouts: 0,
      expiredJobs: 3,
      savedSearchDigests: 0,
      purgedGuestRequests: 0,
      campaignEmailsQueued: 0,
      retention: {},
      purgedMessageAttachments: 0,
      storageDeletions: { claimed: 0, deleted: 0, failed: 0 },
    });
  });

  it('błąd wygaszania → 503 bez pozornego sukcesu i bez szczegółów w odpowiedzi', async () => {
    fakeDb.rpc('expire_due_jobs', () => {
      throw pgError('42501', 'permission denied for function expire_due_jobs');
    });
    const res = await POST(request('Bearer maintenance-secret'));
    expect(res.status).toBe(503);
    // Bez wygaszenia nie wysyłamy alertów; pozostałe zadania idą dalej (osobne transakcje).
    expect(fakeDb.callsTo('process_saved_search_alerts')).toHaveLength(0);
    expect(fakeDb.callsTo('process_email_campaigns')).toHaveLength(1);
    const body = await res.json();
    expect(body).toEqual({ error: 'gc failed' });
    expect(JSON.stringify(body)).not.toContain('maintenance-secret');
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      area: 'maintenance.gc',
      task: 'jobExpiry',
    });
  });
});
