// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #429 — odbiór: `APP_MODE=production` na samym PostgreSQL Railway (bez żadnej zmiennej Supabase)
 * jest gotowe, a brak dowolnej zmiennej rdzenia PostgreSQL daje 503 — zarówno w middleware
 * (strona „prace techniczne” na każdej trasie), jak i w `/api/health` (healthcheck Railway).
 * Lista rdzenia = `PRODUCTION_CORE` niżej; zmiana `isAppReady()` bez zmiany tej listy = czerwony test.
 */

const db = vi.hoisted(() => ({ query: vi.fn(), getDomainPool: vi.fn() }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: db.getDomainPool }));
// next-intl/middleware nie ładuje się w Vitest; gotowość jest sprawdzana przed nim.
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});

import middleware from '@/middleware';
import { GET } from '@/app/api/health/route';
import { isAppReady } from '@/lib/env';
import * as sitemapModule from '@/app/sitemap';

const SITE = 'https://pracuj.be';
const SECRET = 's'.repeat(40);

/** Rdzeń gotowości produkcji (#24, #25, #429) — każda zmienna jest wymagana. */
const PRODUCTION_CORE: Record<string, string> = {
  DATABASE_APP_URL: 'postgresql://web:pw@db.internal:5432/pracujbe',
  DATABASE_SERVICE_URL: 'postgresql://svc:pw@db.internal:5432/pracujbe',
  DATABASE_AUTH_URL: 'postgresql://auth:pw@db.internal:5432/pracujbe',
  DATABASE_RATE_LIMIT_URL: 'postgresql://limiter:pw@db.internal:5432/pracujbe',
  RATE_LIMIT_KEY_SECRET: SECRET,
  BETTER_AUTH_URL: SITE,
  BETTER_AUTH_SECRET: SECRET,
};

/** Zmienne Supabase — żadna nie może być potrzebna do gotowości. */
const SUPABASE_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SEND_EMAIL_HOOK_SECRET',
];

function stubProductionPostgresOnly() {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE);
  vi.stubEnv('SITE_ACCESS_PASSWORD', '');
  for (const [name, value] of Object.entries(PRODUCTION_CORE)) vi.stubEnv(name, value);
  for (const name of SUPABASE_VARS) vi.stubEnv(name, '');
}

const page = (path: string) => new NextRequest(new URL(path, SITE));
const health = () => GET(new Request(`${SITE}/api/health`));

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [{ ok: 1 }] });
  db.getDomainPool.mockReset().mockResolvedValue({ query: db.query });
});
afterEach(() => vi.unstubAllEnvs());

describe('#429: produkcja na samym PostgreSQL', () => {
  it('bez żadnej zmiennej Supabase: isAppReady, strony i healthcheck gotowe', async () => {
    stubProductionPostgresOnly();
    expect(isAppReady()).toBe(true);
    for (const path of ['/pl', '/nl/logowanie', '/fr/oferty-pracy', '/en/candidate']) {
      const response = await middleware(page(path));
      expect(response.status, path).not.toBe(503);
    }
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it.each(Object.keys(PRODUCTION_CORE))('bez %s: 503 w middleware i w /api/health', async (name) => {
    stubProductionPostgresOnly();
    vi.stubEnv(name, '');
    expect(isAppReady()).toBe(false);
    const pageResponse = await middleware(page('/pl'));
    expect(pageResponse.status).toBe(503);
    expect(pageResponse.headers.get('cache-control')).toBe('no-store');
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unconfigured' });
    // Nieskonfigurowana produkcja nie łączy się z bazą.
    expect(db.getDomainPool).not.toHaveBeenCalled();
  });

  it('bez żadnej zmiennej DATABASE_*: 503, nawet z kompletem Supabase', async () => {
    stubProductionPostgresOnly();
    for (const name of Object.keys(PRODUCTION_CORE)) if (name.startsWith('DATABASE_')) vi.stubEnv(name, '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
    expect(isAppReady()).toBe(false);
    expect((await middleware(page('/pl'))).status).toBe(503);
    expect((await health()).status).toBe(503);
  });

  it('komplet zmiennych, ale baza nie odpowiada: strony działają, healthcheck 503 `unavailable`', async () => {
    stubProductionPostgresOnly();
    db.query.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await middleware(page('/pl'))).status).not.toBe(503);
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('kontrola ujemna: tryb demo (bez APP_MODE) nie wymaga rdzenia — brak zmiennych nie daje 503', async () => {
    vi.stubEnv('APP_MODE', '');
    for (const name of Object.keys(PRODUCTION_CORE)) vi.stubEnv(name, '');
    expect(isAppReady()).toBe(true);
    expect((await middleware(page('/pl'))).status).not.toBe(503);
    expect((await health()).status).toBe(200);
  });

  it('sitemap nie jest prerenderowany w buildzie produkcyjnym (bez bazy w buildzie przerywał build)', () => {
    // Kontrola: build z APP_MODE=production i zmiennymi Railway bez tej linii kończył się
    // „sitemap: brak liczników kategorii” (odtworzone lokalnie, #429).
    expect(sitemapModule.dynamic).toBe('force-dynamic');
  });
});
