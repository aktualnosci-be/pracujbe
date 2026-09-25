// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Limiter (#24): przy `DATABASE_RATE_LIMIT_URL` + `RATE_LIMIT_KEY_SECRET` działa na PostgreSQL
 * (osobny login `pracujbe_rate_limit`, klucz HMAC); awaria bazy blokuje akcje auth (fail-safe). Produkcja bez limitera blokuje
 * akcje wrażliwe zamiast je przepuszczać.
 */

const db = vi.hoisted(() => ({ check: vi.fn(), pool: vi.fn() }));
vi.mock('@/lib/db/rate-limit', () => ({ checkDatabaseRateLimit: db.check }));
vi.mock('@/lib/db/runtime', () => ({ getRateLimitPool: db.pool }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-real-ip': '203.0.113.7' }) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { checkRateLimit } from '@/lib/rate-limit';

const SECRET = 'k'.repeat(40);

beforeEach(() => {
  db.check.mockReset().mockResolvedValue(true);
  db.pool.mockReset().mockResolvedValue({ connect: vi.fn() });
});
afterEach(() => vi.unstubAllEnvs());

function stubLimiter() {
  vi.stubEnv('DATABASE_RATE_LIMIT_URL', 'postgresql://limiter:pw@localhost:5432/app');
  vi.stubEnv('RATE_LIMIT_KEY_SECRET', SECRET);
}

describe('checkRateLimit na PostgreSQL', () => {
  it('używa limitera PostgreSQL z IP proxy i sekretem HMAC', async () => {
    stubLimiter();
    expect(await checkRateLimit('signin', { max: 10, windowSeconds: 300 })).toBe(true);
    expect(db.check).toHaveBeenCalledWith(expect.anything(), {
      action: 'signin', trustedClientIp: '203.0.113.7', max: 10, windowSeconds: 300, keySecret: SECRET,
    });
  });

  it('przekroczenie limitu → false', async () => {
    stubLimiter();
    db.check.mockResolvedValue(false);
    expect(await checkRateLimit('register', { max: 5, windowSeconds: 3600 })).toBe(false);
  });

  it('awaria puli: akcja auth zablokowana, zwykła przepuszczona', async () => {
    stubLimiter();
    db.pool.mockRejectedValue(new Error('pool down'));
    expect(await checkRateLimit('signin')).toBe(false);
    expect(await checkRateLimit('verify-email')).toBe(false);
    expect(await checkRateLimit('message')).toBe(true);
  });

  it('limit tylko per identyfikator (perIp=false) nie zależy od adresu', async () => {
    stubLimiter();
    await checkRateLimit('job-import', { perIp: false, identifier: 'company-1' });
    expect(db.check.mock.calls[0]![1]).toMatchObject({ trustedClientIp: '0.0.0.0', identifier: 'company-1' });
  });

  it('za krótki sekret = brak limitera PostgreSQL', async () => {
    stubLimiter();
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'krotki');
    vi.stubEnv('APP_MODE', 'production');
    expect(await checkRateLimit('signin')).toBe(false);
    expect(db.check).not.toHaveBeenCalled();
  });

  it('produkcja bez żadnego limitera: akcje wrażliwe blokowane, zwykłe przepuszczane', async () => {
    vi.stubEnv('APP_MODE', 'production');
    expect(await checkRateLimit('signin')).toBe(false);
    expect(await checkRateLimit('password-reset')).toBe(false);
    expect(await checkRateLimit('message')).toBe(true);
  });

  it('tryb demo bez limitera przepuszcza', async () => {
    vi.stubEnv('APP_MODE', '');
    expect(await checkRateLimit('signin')).toBe(true);
  });
});
