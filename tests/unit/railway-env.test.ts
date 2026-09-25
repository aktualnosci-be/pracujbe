// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #429: gotowość produkcji wynika z docelowego backendu PostgreSQL Railway (pula domeny, Better
 * Auth, limiter, kanoniczny https URL), nie z Supabase. `/api/health` sprawdza też realną
 * łączność z bazą (`SELECT 1` z limitem czasu) — healthcheck Railway nie przejdzie bez bazy.
 */

const db = vi.hoisted(() => ({ query: vi.fn(), getDomainPool: vi.fn() }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: db.getDomainPool }));

import { env, isAppReady, isProductionDeployment, readinessChecks } from '@/lib/env';
import { GET } from '@/app/api/health/route';

const SECRET = 'x'.repeat(40);

/** Komplet zmiennych produkcji na samym PostgreSQL (bez Supabase). */
function stubPostgresProduction(site = 'https://pracuj.be') {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', site);
  vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:pw@db.internal:5432/pracujbe');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:pw@db.internal:5432/pracujbe');
  vi.stubEnv('BETTER_AUTH_URL', site);
  vi.stubEnv('BETTER_AUTH_SECRET', SECRET);
  vi.stubEnv('DATABASE_RATE_LIMIT_URL', 'postgresql://limiter:pw@db.internal:5432/pracujbe');
  vi.stubEnv('RATE_LIMIT_KEY_SECRET', SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
}

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [{ ok: 1 }] });
  db.getDomainPool.mockReset().mockResolvedValue({ query: db.query });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Jawny tryb aplikacji niezależny od hostingu', () => {
  it.each(['', 'demo', 'invalid'])('nie zgaduje produkcji dla APP_MODE=%s', (mode) => {
    vi.stubEnv('APP_MODE', mode);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(env.appMode).toBe('demo');
  });

  it('produkcja na samym PostgreSQL (bez Supabase) jest gotowa, a healthcheck zwraca 200', async () => {
    stubPostgresProduction();
    expect(isAppReady()).toBe(true);
    const response = await GET(new Request('https://pracuj.be/api/health'));
    expect(response.status).toBe(200);
    // Publicznie tylko ogólny status (P3-01).
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(db.query).toHaveBeenCalledWith('SELECT 1 AS ok');
  });

  it('odmawia gotowości produkcji bez bazy (503) — Supabase jej nie zastępuje', async () => {
    stubPostgresProduction();
    vi.stubEnv('DATABASE_APP_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
    expect(isAppReady()).toBe(false);
    const response = await GET(new Request('https://pracuj.be/api/health'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unconfigured' });
    expect(db.getDomainPool).not.toHaveBeenCalled();
  });

  it.each([
    ['DATABASE_AUTH_URL', ''],
    ['BETTER_AUTH_SECRET', ''],
    ['BETTER_AUTH_URL', ''],
    ['BETTER_AUTH_URL', 'https://inny-host.example'],
    ['BETTER_AUTH_URL', 'https://pracuj.be/api/auth'],
    ['DATABASE_RATE_LIMIT_URL', ''],
    ['RATE_LIMIT_KEY_SECRET', 'za-krotki'],
  ])('odmawia gotowości produkcji przy %s=%s', async (name, value) => {
    stubPostgresProduction();
    vi.stubEnv(name, value);
    expect(isAppReady()).toBe(false);
    expect((await GET(new Request('https://pracuj.be/api/health'))).status).toBe(503);
  });

  it('niedostępna baza → 503 `unavailable`, bez treści błędu sterownika', async () => {
    stubPostgresProduction();
    db.query.mockRejectedValue(new Error('connect ECONNREFUSED postgresql://web:pw@db.internal'));
    const response = await GET(new Request('https://pracuj.be/api/health'));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: 'unavailable' });
    expect(text).not.toContain('ECONNREFUSED');
  });

  it('zawieszona baza → 503 po limicie czasu (healthcheck nie wisi)', async () => {
    stubPostgresProduction();
    vi.useFakeTimers();
    db.query.mockReturnValue(new Promise(() => undefined));
    const pending = GET(new Request('https://pracuj.be/api/health'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await pending).status).toBe(503);
  });

  it('szczegóły z tokenem raportują konfigurację i łączność PostgreSQL, bez sekretów', async () => {
    stubPostgresProduction();
    vi.stubEnv('HEALTH_CHECK_SECRET', 'h'.repeat(40));
    const response = await GET(new Request('https://pracuj.be/api/health', {
      headers: { 'x-health-token': 'h'.repeat(40) },
    }));
    const body = await response.json();
    expect(body.checks).toMatchObject({
      database: true, auth: true, authUrl: true, rateLimit: true, databaseReachable: true, httpsSiteUrl: true,
    });
    expect(body.checks).not.toHaveProperty('supabase');
    expect(JSON.stringify(body)).not.toContain('pw@');
  });

  it('pozwala na gotowy staging, zachowując brak indeksowania', async () => {
    stubPostgresProduction('https://staging.pracuj.be');
    expect(isAppReady()).toBe(true);
    expect(isProductionDeployment()).toBe(false);
    expect((await GET(new Request('https://staging.pracuj.be/api/health'))).status).toBe(200);
  });

  it.each(['http://pracuj.be', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'not-a-url'])('odrzuca nieprawidłowy URL gotowości: %s', (url) => {
    stubPostgresProduction();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', url);
    vi.stubEnv('BETTER_AUTH_URL', url);
    expect(isAppReady()).toBe(false);
  });

  it('tryb demo jest zawsze gotowy, a checks nie wymieniają Supabase', () => {
    vi.stubEnv('APP_MODE', '');
    expect(isAppReady()).toBe(true);
    expect(Object.keys(readinessChecks())).not.toContain('supabase');
  });
});
