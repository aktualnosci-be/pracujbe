// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #1143 — /api/maintenance w trybie ogłoszeniowym nie woła zadań procesu rekrutacyjnego
 * (materializacja `matches`), a odpowiedź mówi `skipped: 'classifieds_only'`. Retencja
 * i czyszczenie (gość, załączniki, storage) działają dalej. Tryb efektywny = env ORAZ baza.
 */
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => true), fileBucketConfig: () => null }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { POST } = await import('@/app/api/maintenance/route');
const { isProductionMode } = await import('@/lib/env');
const { captureError } = await import('@/lib/error-report');

const RPCS = [
  'ai_budget_release_stale_reservations', 'expire_due_jobs', 'match_recompute_claim',
  'purge_guest_application_requests', 'process_saved_search_alerts', 'process_email_campaigns',
  'purge_job_funnel_data', 'purge_stale_message_attachments', 'rate_limit_gc',
  'processed_webhooks_gc',
];
const RECRUITMENT_RPCS = ['match_recompute_claim', 'match_recompute_inputs', 'match_recompute_apply'];
/** Zadania retencji/czyszczenia — muszą działać także w trybie ogłoszeniowym. */
const CLEANUP_RPCS = ['purge_guest_application_requests', 'purge_stale_message_attachments', 'claim_storage_deletions'];

const request = () =>
  new Request('http://web.internal/api/maintenance', {
    method: 'POST',
    headers: { authorization: 'Bearer maintenance-secret' },
  });
const called = () => fakeDb.calls.map((c) => c.name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isProductionMode).mockReturnValue(true);
  resetFakeDb(null);
  for (const fn of RPCS) fakeDb.rpc(fn, 0);
  fakeDb.rpc('claim_storage_deletions', []);
  fakeDb.rpc('claim_company_vies_auto_checks', []);
  vi.stubEnv('MAINTENANCE_SECRET', 'maintenance-secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('/api/maintenance a tryb portalu (#1143)', () => {
  it('tryb ogłoszeniowy (brak env): bez zadań rekrutacyjnych i bez pytania bazy o tryb', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matches: 'disabled', recruitmentTasks: { skipped: 'classifieds_only' } });
    expect(called()).not.toContain('recruitment_enabled');
    for (const fn of RECRUITMENT_RPCS) expect(called()).not.toContain(fn);
    for (const fn of CLEANUP_RPCS) expect(called()).toContain(fn);
  });

  it('env RECRUITMENT, baza ogłoszeniowa (rozbieżność) → nadal pominięte', async () => {
    vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');
    fakeDb.rpc('recruitment_enabled', false);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ matches: 'disabled', recruitmentTasks: { skipped: 'classifieds_only' } });
    expect(fakeDb.callsTo('recruitment_enabled')).toEqual([expect.objectContaining({ as: 'service' })]);
    expect(called()).not.toContain('match_recompute_claim');
  });

  it('env RECRUITMENT × baza RECRUITMENT → materializacja dopasowań działa', async () => {
    vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');
    fakeDb.rpc('recruitment_enabled', true);
    fakeDb.rpc('match_recompute_claim', []);
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recruitmentTasks).toBeUndefined();
    expect(body.matches).toMatchObject({ subjects: 0 });
    expect(called()).toContain('match_recompute_claim');
    // Kolejność: tryb sprawdzany przed materializacją.
    expect(called().indexOf('recruitment_enabled')).toBeLessThan(called().indexOf('match_recompute_claim'));
  });

  it('błąd odczytu trybu z bazy → fail-closed (bez zadań rekrutacyjnych) i 503 dla monitoringu', async () => {
    vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');
    fakeDb.rpc('recruitment_enabled', () => { throw pgError('XX000', 'x'); });
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(called()).not.toContain('match_recompute_claim');
    for (const fn of CLEANUP_RPCS) expect(called()).toContain(fn);
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'portalMode' });
  });

  it('kontrola ujemna: literówka w env (np. „RECRUITMENT_”) nie włącza zadań rekrutacyjnych', async () => {
    vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT_');
    fakeDb.rpc('recruitment_enabled', true);
    await POST(request());
    expect(called()).not.toContain('recruitment_enabled');
    expect(called()).not.toContain('match_recompute_claim');
  });
});
