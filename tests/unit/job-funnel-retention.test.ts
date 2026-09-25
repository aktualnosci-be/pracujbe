import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #575 — twarde terminy lejka ofert w cronie `/api/maintenance`: `purge_job_funnel_data`
 * (0128) jako service_role, w odpowiedzi same liczniki, błąd → 503. Migracja ustala terminy
 * 48 h (receipts) i 13 miesięcy kalendarzowych (agregaty); pełny dowód w `rls.sql` sekcja FC575.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(), fileBucketConfig: () => null }));
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
  'purge_job_funnel_data',
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
  fakeDb.rpc('claim_storage_deletions', []);
});

describe('maintenance: terminy lejka ofert (#575)', () => {
  it('woła purge_job_funnel_data jako service_role i zwraca tylko liczniki', async () => {
    fakeDb.rpc('purge_job_funnel_data', { receipts: 7, daily: 2, note: 'x' });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('purge_job_funnel_data')).toEqual([
      expect.objectContaining({ args: { p_limit: 5000 }, as: 'service' }),
    ]);
    expect(await res.json()).toMatchObject({ ok: true, jobFunnel: { receipts: 7, daily: 2 } });
  });

  it('błąd czyszczenia → 503 bez pozornego sukcesu', async () => {
    fakeDb.rpc('purge_job_funnel_data', () => {
      throw pgError('42501', 'permission denied');
    });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'gc failed' });
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'jobFunnel' });
  });
});

describe('migracja 0128: terminy w SQL', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0128_job_funnel_retention.sql'),
    'utf8',
  );

  it('receipts 48 h (zadanie i zapis), agregaty od progu 12 miesięcy wstecz od bieżącego', () => {
    expect(sql.match(/interval '48 hours'/g)).toHaveLength(2);
    expect(sql).toMatch(/date_trunc\('month', \(p_now at time zone 'Europe\/Brussels'\)\) - interval '12 months'/);
    expect(sql).toMatch(/grant execute on function public\.purge_job_funnel_data\(integer\) to service_role;/);
    expect(sql).not.toMatch(/purge_job_funnel_data\(integer\) to [^;]*(anon|authenticated)/);
  });
});
