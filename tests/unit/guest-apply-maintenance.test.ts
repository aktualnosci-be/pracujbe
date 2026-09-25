import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/** #98 — retencja zgłoszeń gościa w crona /api/maintenance: licznik i 503 przy błędzie. */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(), fileBucketConfig: () => null }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { POST } = await import('@/app/api/maintenance/route');
const { isProductionMode } = await import('@/lib/env');
const { captureError } = await import('@/lib/error-report');

const MAINTENANCE_RPCS = [
  'release_stale_discount_reservations',
  'release_stale_checkout_intents',
  'expire_due_jobs',
  'purge_guest_application_requests',
  'process_saved_search_alerts',
  'process_email_campaigns',
  'run_retention_purge',
  'purge_job_funnel_data',
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

describe('maintenance: kolejka storage bez bucketu (#27)', () => {
  it('pusta kolejka = 200; wiersz bez bucketu = ponowienie z kodem, nie 503', async () => {
    expect((await POST(request())).status).toBe(200);

    fakeDb
      .rpc('claim_storage_deletions', [{ id: 'q1', bucket: 'candidate-files', path: 'u1/cv.pdf' }])
      .rpc('complete_storage_deletion', null);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ storageDeletions: { claimed: 1, deleted: 0, failed: 1 } });
    expect(fakeDb.callsTo('complete_storage_deletion')[0]?.args).toEqual({ p_id: 'q1', p_ok: false, p_error: 'STORAGE_UNCONFIGURED' });
  });
});

describe('maintenance: czyszczenie spraw DSA za jawną flagą (#43)', () => {
  const env = process.env.DSA_RETENTION_MODE;
  const summary = { eligibleCases: 3, redactedCases: 2, policy: { retentionDays: 365 }, runId: 'r1', dryRun: false };
  const restore = () => {
    if (env === undefined) delete process.env.DSA_RETENTION_MODE;
    else process.env.DSA_RETENTION_MODE = env;
  };

  it('domyślnie wyłączone: bez zmiennej i przy nieznanej wartości baza nie jest wołana', async () => {
    try {
      for (const value of [undefined, '', 'true', 'APPLY', 'dryrun', ' apply']) {
        if (value === undefined) delete process.env.DSA_RETENTION_MODE;
        else process.env.DSA_RETENTION_MODE = value;
        resetFakeDb(null);
        for (const fn of MAINTENANCE_RPCS) fakeDb.rpc(fn, 0);
        const res = await POST(request());
        expect(res.status).toBe(200);
        expect(fakeDb.callsTo('dsa_retention_run')).toHaveLength(0);
        expect(await res.json()).toMatchObject({ dsaRetention: { mode: 'off' } });
      }
    } finally {
      restore();
    }
  });

  it('dry-run: podgląd z licznikami, bez anonimizacji', async () => {
    try {
      process.env.DSA_RETENTION_MODE = 'dry-run';
      fakeDb.rpc('dsa_retention_run', { ...summary, redactedCases: undefined, dryRun: true });
      const res = await POST(request());
      expect(res.status).toBe(200);
      expect(fakeDb.callsTo('dsa_retention_run')[0]).toMatchObject({ args: { p_dry_run: true }, as: 'service' });
      expect((await res.json()).dsaRetention).toEqual({ mode: 'dry-run', eligibleCases: 3 });
    } finally {
      restore();
    }
  });

  it('apply: anonimizacja, odpowiedź tylko z liczbami (bez runId i polityki)', async () => {
    try {
      process.env.DSA_RETENTION_MODE = 'apply';
      fakeDb.rpc('dsa_retention_run', summary);
      const res = await POST(request());
      expect(fakeDb.callsTo('dsa_retention_run')[0]).toMatchObject({ args: { p_dry_run: false }, as: 'service' });
      expect((await res.json()).dsaRetention).toEqual({ mode: 'apply', eligibleCases: 3, redactedCases: 2 });
    } finally {
      restore();
    }
  });

  it('błąd przebiegu → 503 (bez pozornego sukcesu)', async () => {
    try {
      process.env.DSA_RETENTION_MODE = 'apply';
      fakeDb.rpc('dsa_retention_run', () => { throw pgError('XX000', 'x'); });
      const res = await POST(request());
      expect(res.status).toBe(503);
      expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'maintenance.gc', task: 'dsaRetention' });
    } finally {
      restore();
    }
  });
});
