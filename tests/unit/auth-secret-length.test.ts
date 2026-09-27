// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * #873: `isAuthRuntimeConfigured()` (i przez nią `isAppReady()`/`readinessChecks().auth`) musi
 * odrzucić `BETTER_AUTH_SECRET` krótszy niż 32 znaki — to samo minimum, którego wymaga
 * `createAuthServer` (`src/lib/auth/server.ts`: `dependencies.secret.trim().length < 32`).
 * Bez tej kontroli readiness/`isAppReady()` mogły zgłosić gotowość produkcji z sekretem, który
 * i tak wysadza inicjalizację Better Auth w runtime (fałszywa gotowość zamiast fail-closed).
 */

async function loadEnv() {
  return import('@/lib/env');
}

function configureCore() {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:pw@db.internal:5432/pracujbe');
  vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:pw@db.internal:5432/pracujbe');
  vi.stubEnv('BETTER_AUTH_URL', 'https://pracuj.be');
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('#873: minimalna długość BETTER_AUTH_SECRET w readiness', () => {
  it('sekret krótszy niż 32 znaki → auth NIE jest skonfigurowany (fail-closed)', async () => {
    configureCore();
    vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(31));
    const { isAuthRuntimeConfigured, isPortalAuthConfigured } = await loadEnv();
    expect(isAuthRuntimeConfigured()).toBe(false);
    expect(isPortalAuthConfigured()).toBe(false);
  });

  it('sekret dokładnie 32 znaki → auth skonfigurowany', async () => {
    configureCore();
    vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(32));
    const { isAuthRuntimeConfigured } = await loadEnv();
    expect(isAuthRuntimeConfigured()).toBe(true);
  });

  it('sekret z otaczającymi spacjami liczony jest po trim() (jak w createAuthServer)', async () => {
    configureCore();
    vi.stubEnv('BETTER_AUTH_SECRET', `  ${'a'.repeat(31)}  `);
    const { isAuthRuntimeConfigured } = await loadEnv();
    expect(isAuthRuntimeConfigured()).toBe(false);
  });

  it('pusty sekret → auth nieskonfigurowany (bez regresji istniejącego zachowania)', async () => {
    configureCore();
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    const { isAuthRuntimeConfigured } = await loadEnv();
    expect(isAuthRuntimeConfigured()).toBe(false);
  });

  it('kontrola ujemna: zbyt krótki sekret nie może przejść razem z resztą rdzenia w isAppReady()', async () => {
    configureCore();
    vi.stubEnv('DATABASE_SERVICE_URL', 'postgresql://svc:pw@db.internal:5432/pracujbe');
    vi.stubEnv('DATABASE_RATE_LIMIT_URL', 'postgresql://limiter:pw@db.internal:5432/pracujbe');
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'b'.repeat(32));
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
    vi.stubEnv('BETTER_AUTH_SECRET', 'krotki-sekret');
    const { isAppReady } = await loadEnv();
    // Odtworzenie z opisu zgłoszenia: reszta rdzenia jest gotowa, tylko sekret jest za krótki.
    expect(isAppReady()).toBe(false);
  });
});
