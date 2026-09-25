// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/auth/[...all]` (#24): bez konfiguracji kont → 404 bez łączenia z bazą; z konfiguracją
 * publiczny jest WYŁĄCZNIE `GET /get-session`. Rejestracja, logowanie, reset i weryfikacja przez
 * HTTP SDK omijałyby limiter, Turnstile i Zod akcji — dostają 404 i nie docierają do SDK.
 */

const runtime = vi.hoisted(() => ({ handler: vi.fn(), getAuthRuntime: vi.fn() }));
vi.mock('@/lib/auth/runtime', () => ({ getAuthRuntime: runtime.getAuthRuntime }));

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/auth/[...all]/route';
import { ALLOWED_AUTH_ENDPOINTS, isAllowedAuthRequest } from '@/lib/auth/http-allowlist';

const BASE = 'https://pracuj.be/api/auth';

function stubConfigured() {
  vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:pw@localhost:5432/app');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:pw@localhost:5432/app');
  vi.stubEnv('BETTER_AUTH_URL', 'https://pracuj.be');
  vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(40));
}

beforeEach(() => {
  runtime.handler.mockReset().mockResolvedValue(Response.json({ session: null }));
  runtime.getAuthRuntime.mockReset().mockResolvedValue({ handler: runtime.handler });
});
afterEach(() => vi.unstubAllEnvs());

describe('trasa Better Auth', () => {
  it('bez konfiguracji kont → 404 i brak inicjalizacji runtime', async () => {
    vi.stubEnv('DATABASE_AUTH_URL', '');
    const response = await GET(new Request(`${BASE}/get-session`));
    expect(response.status).toBe(404);
    expect(runtime.getAuthRuntime).not.toHaveBeenCalled();
  });

  it('GET /get-session trafia do SDK, bez cache', async () => {
    stubConfigured();
    const response = await GET(new Request(`${BASE}/get-session`, { headers: { cookie: 'a=b' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(runtime.handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['POST', '/sign-up/email', POST],
    ['POST', '/sign-in/email', POST],
    ['POST', '/sign-out', POST],
    ['POST', '/request-password-reset', POST],
    ['POST', '/reset-password', POST],
    ['GET', '/reset-password/abcdef', GET],
    ['GET', '/verify-email', GET],
    ['POST', '/send-verification-email', POST],
    ['POST', '/update-user', POST],
    ['POST', '/change-password', POST],
    ['POST', '/change-email', POST],
    ['POST', '/delete-user', POST],
    ['GET', '/list-sessions', GET],
    ['POST', '/revoke-sessions', POST],
    ['POST', '/get-session', POST],
    ['GET', '/get-session/', GET],
    ['GET', '/get-session%2F..%2Fverify-email', GET],
    ['PUT', '/get-session', PUT],
    ['PATCH', '/get-session', PATCH],
    ['DELETE', '/get-session', DELETE],
  ] as const)('%s %s → 404 bez wywołania SDK', async (method, path, handler) => {
    stubConfigured();
    const response = await handler(new Request(`${BASE}${path}`, { method }));
    expect(response.status).toBe(404);
    expect(runtime.handler).not.toHaveBeenCalled();
  });

  it('awaria runtime → 503 bez szczegółów konfiguracji', async () => {
    stubConfigured();
    runtime.getAuthRuntime.mockRejectedValue(new Error('postgresql://auth:pw@localhost failed'));
    const response = await GET(new Request(`${BASE}/get-session`));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('lista dozwolonych operacji jest jawna i minimalna', () => {
    expect(ALLOWED_AUTH_ENDPOINTS).toEqual({ GET: ['/get-session'] });
    expect(isAllowedAuthRequest('GET', '/api/auth/get-session')).toBe(true);
    expect(isAllowedAuthRequest('GET', '/api/authget-session')).toBe(false);
  });
});
