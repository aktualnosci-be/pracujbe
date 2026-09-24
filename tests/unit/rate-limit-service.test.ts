// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #25 — limiter aplikacyjny (`checkRateLimit`) na `rate_limit_hit` w transakcji service_role:
 * klucz z akcji + IP (+ identyfikator), tryb demo bez bazy, fail-open i fail-safe (auth).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.9, 203.0.113.7' }),
}));

const { checkRateLimit } = await import('@/lib/rate-limit');

beforeEach(() => {
  resetFakeDb(null);
});

describe('checkRateLimit', () => {
  it('w limicie → true; klucz z prawego tokenu XFF, limit i okno z serwera; service_role', async () => {
    fakeDb.rpc('rate_limit_hit', true);
    expect(await checkRateLimit('apply', { max: 5, windowSeconds: 120, identifier: 'u1' })).toBe(true);
    const [call] = fakeDb.callsTo('rate_limit_hit');
    expect(call).toMatchObject({
      as: 'service',
      args: { p_key: 'apply:203.0.113.7:u1', p_max: 5, p_window_seconds: 120 },
    });
  });

  it('przekroczenie (RPC false) → false', async () => {
    fakeDb.rpc('rate_limit_hit', false);
    expect(await checkRateLimit('apply')).toBe(false);
  });

  it('perIp=false → klucz wyłącznie z identyfikatora', async () => {
    fakeDb.rpc('rate_limit_hit', true);
    await checkRateLimit('job-import', { perIp: false, identifier: 'company-1' });
    expect(fakeDb.callsTo('rate_limit_hit')[0]?.args['p_key']).toBe('job-import:company-1');
  });

  it('błąd bazy: zwykła akcja fail-open, logowanie fail-safe', async () => {
    fakeDb.rpc('rate_limit_hit', () => {
      throw pgError('08006', 'db down');
    });
    expect(await checkRateLimit('apply')).toBe(true);
    expect(await checkRateLimit('signin')).toBe(false);
  });

  it('tryb demo (brak puli domeny i service) → true bez zapytań', async () => {
    fakeSession.configured = false;
    fakeSession.serviceConfigured = false;
    expect(await checkRateLimit('signin')).toBe(true);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('portal bez puli service (dryf env) nie jest demo: próba wywołania, błąd → fail-safe dla auth', async () => {
    fakeSession.serviceConfigured = false;
    fakeDb.rpc('rate_limit_hit', () => {
      throw new Error('Brak konfiguracji połączenia zadań serwerowych.');
    });
    expect(await checkRateLimit('signin')).toBe(false);
    expect(await checkRateLimit('apply')).toBe(true);
  });
});
