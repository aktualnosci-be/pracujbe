// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, isAppReady, isProductionDeployment } from '@/lib/env';
import { GET } from '@/app/api/health/route';

afterEach(() => vi.unstubAllEnvs());

describe('Jawny tryb aplikacji niezależny od hostingu', () => {
  it.each(['', 'demo', 'invalid'])('nie zgaduje produkcji dla APP_MODE=%s', (mode) => {
    vi.stubEnv('APP_MODE', mode);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(env.appMode).toBe('demo');
  });
  function stubBackend() {
    vi.stubEnv('DATABASE_APP_URL', 'postgresql://web:x@db.internal:5432/app');
    vi.stubEnv('DATABASE_SERVICE_URL', 'postgresql://svc:x@db.internal:5432/app');
    vi.stubEnv('DATABASE_AUTH_URL', 'postgresql://auth:x@db.internal:5432/app');
    vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('BETTER_AUTH_URL', 'https://pracuj.be');
  }
  it('odmawia gotowości produkcji bez rdzenia konfiguracji', () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('DATABASE_APP_URL', '');
    vi.stubEnv('DATABASE_SERVICE_URL', '');
    vi.stubEnv('DATABASE_AUTH_URL', '');
    expect(isAppReady()).toBe(false);
    expect(GET(new Request('https://pracuj.be/api/health')).status).toBe(503);
  });
  it.each(['DATABASE_APP_URL', 'DATABASE_SERVICE_URL', 'DATABASE_AUTH_URL', 'BETTER_AUTH_SECRET'])(
    'odmawia gotowości bez %s (#25: rdzeń = PostgreSQL + sesje, nie klucze Supabase)', (name) => {
      vi.stubEnv('APP_MODE', 'production');
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
      stubBackend();
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon');
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
      vi.stubEnv(name, '');
      expect(isAppReady()).toBe(false);
    },
  );
  it('pozwala na gotowy staging, zachowując brak indeksowania', () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.pracuj.be');
    stubBackend();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(isAppReady()).toBe(true);
    expect(isProductionDeployment()).toBe(false);
    expect(GET(new Request('https://staging.pracuj.be/api/health')).status).toBe(200);
  });
  it.each(['http://pracuj.be', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'not-a-url'])('odrzuca nieprawidłowy URL gotowości: %s', (url) => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', url);
    stubBackend();
    expect(isAppReady()).toBe(false);
  });
});
