// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readOpsMetrics = vi.fn();
const domainPoolStats = vi.fn(() => null);
vi.mock('@/lib/ops/metrics-source', () => ({ readOpsMetrics: () => readOpsMetrics() }));
vi.mock('@/lib/db/runtime', () => ({ domainPoolStats: () => domainPoolStats() }));

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
    expect(body).toMatchObject({ status: 'ok', alerts: [], warnings: [], metrics, appPool: null });
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

  it.each([
    ['error', 'unavailable'],
    ['unconfigured', 'unconfigured'],
  ] as const)('źródło %s → 503 %s bez szczegółów', async (kind, status) => {
    readOpsMetrics.mockResolvedValue({ kind });
    const res = await call(SECRET);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['checkedAt', 'status']);
    expect(body.status).toBe(status);
  });
});
