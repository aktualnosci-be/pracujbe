// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readOpsMetrics = vi.fn();
const domainPoolStats = vi.fn(() => null);
vi.mock('@/lib/ops/metrics-source', () => ({ readOpsMetrics: () => readOpsMetrics() }));
vi.mock('@/lib/db/runtime', () => ({ domainPoolStats: () => domainPoolStats() }));
const readBackupFreshness = vi.fn();
vi.mock('@/lib/ops/backup-freshness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ops/backup-freshness')>()),
  readBackupFreshness: () => readBackupFreshness(),
}));
const freshBackup = { status: 'ok', ageSeconds: 3600, lastBackupAt: '2026-09-25T03:00:00.000Z' } as const;

import { GET } from '@/app/api/health/ops/route';

const SECRET = 'ops-token-0123456789abcdef';
const metrics = {
  email: { ready: 1, oldestReadyAgeSeconds: 30, abandonedLeases: 0, failedLast24h: 0 },
  authEmail: null,
  webhooks: { stuckProcessing: 0, failedLast24h: 0 },
  maintenance: { overdueActiveJobs: 0, staleDiscountReservations: 0, staleCheckoutIntents: 0 },
  connections: { used: 4, max: 100, reserved: 3 },
};

function call(token?: string) {
  const headers = token === undefined ? undefined : { 'x-health-token': token };
  return GET(new Request('https://pracuj.be/api/health/ops', { headers }));
}

beforeEach(() => {
  readOpsMetrics.mockReset();
  readBackupFreshness.mockReset();
  readBackupFreshness.mockResolvedValue(freshBackup);
  vi.stubEnv('HEALTH_CHECK_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health/ops (#47)', () => {
  it.each([undefined, '', 'zly-token', `${SECRET}x`])('bez poprawnego tokena → 404 bez odczytu metryk (%s)', async (token) => {
    const res = await call(token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(readOpsMetrics).not.toHaveBeenCalled();
  });

  it('bez skonfigurowanego sekretu endpoint jest wyłączony także poza produkcją', async () => {
    vi.stubEnv('HEALTH_CHECK_SECRET', '');
    vi.stubEnv('APP_MODE', 'demo');
    expect((await call('')).status).toBe(404);
    expect(readOpsMetrics).not.toHaveBeenCalled();
  });

  it('zdrowy stan → 200 ok z liczbami, bez buforowania', async () => {
    readOpsMetrics.mockResolvedValue({ kind: 'ok', metrics });
    const res = await call(SECRET);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', alerts: [], warnings: [], metrics, appPool: null, backup: freshBackup });
    expect(typeof body.checkedAt).toBe('string');
  });

  it('przekroczony próg → 503 alert z kodem sygnału', async () => {
    readOpsMetrics.mockResolvedValue({
      kind: 'ok', metrics: { ...metrics, webhooks: { stuckProcessing: 2, failedLast24h: 0 } },
    });
    const res = await call(SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'alert', alerts: ['webhook_stuck'] });
  });

  it('wyczerpany budżet AI (#36) → 503 alert, stan budżetu w odpowiedzi (same liczby)', async () => {
    const aiBudget = {
      day: { spentMicroUsd: 10_000_000, limitMicroUsd: 10_000_000 },
      month: { spentMicroUsd: 10_000_000, limitMicroUsd: 100_000_000 },
      staleReservations: 0,
    };
    readOpsMetrics.mockResolvedValue({ kind: 'ok', metrics, aiBudget });
    const res = await call(SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'alert', alerts: ['ai_budget_exhausted'], aiBudget });
  });

  it('0213: stary ostatni przebieg maintenance → 503 alert; brak przebiegu = tylko ostrzeżenie (200)', async () => {
    const run = { finishedAt: '2026-09-26T05:00:00Z', ageSeconds: 7201, ok: true, durationMs: 900, failedTask: null };
    readOpsMetrics.mockResolvedValue({ kind: 'ok', metrics, aiBudget: null, maintenanceRun: run });
    let res = await call(SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'alert', alerts: ['maintenance_run_stale'], maintenanceRun: run });

    const never = { finishedAt: null, ageSeconds: null, ok: null, durationMs: null, failedTask: null };
    readOpsMetrics.mockResolvedValue({ kind: 'ok', metrics, maintenanceRun: never });
    res = await call(SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', alerts: [], warnings: ['maintenance_run_missing'] });
  });

  it.each([
    ['error', 'unavailable'],
    ['unconfigured', 'unconfigured'],
  ] as const)('źródło %s → 503 %s bez szczegółów', async (kind, status) => {
    readOpsMetrics.mockResolvedValue({ kind });
    const res = await call(SECRET);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['backup', 'checkedAt', 'status']);
    expect(body.status).toBe(status);
  });

  it.each([
    [{ status: 'unconfigured' }, 'backup_unconfigured'],
    [{ status: 'misconfigured' }, 'backup_misconfigured'],
    [{ status: 'unavailable' }, 'backup_unavailable'],
    [{ status: 'missing' }, 'backup_missing'],
    [{ status: 'stale', ageSeconds: 200_000, lastBackupAt: '2026-09-22T03:00:00.000Z' }, 'backup_stale'],
  ] as const)('#569: kopia %o → 503 alert %s (brak konfiguracji to nie „OK”)', async (backup, signal) => {
    readOpsMetrics.mockResolvedValue({ kind: 'ok', metrics });
    readBackupFreshness.mockResolvedValue(backup);
    const res = await call(SECRET);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'alert', alerts: [signal], backup });
    expect(JSON.stringify(body)).not.toMatch(/r2\.cloudflarestorage|BACKUP_S3/);
  });
});
