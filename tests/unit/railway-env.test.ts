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
  it('odmawia gotowości produkcji bez rdzenia konfiguracji', () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(isAppReady()).toBe(false);
    expect(GET(new Request('https://pracuj.be/api/health')).status).toBe(503);
  });
  it('pozwala na gotowy staging, zachowując brak indeksowania', () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.pracuj.be');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
    expect(isAppReady()).toBe(true);
    expect(isProductionDeployment()).toBe(false);
    expect(GET(new Request('https://staging.pracuj.be/api/health')).status).toBe(200);
  });
  it.each(['http://pracuj.be', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'not-a-url'])('odrzuca nieprawidłowy URL gotowości: %s', (url) => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', url);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
    expect(isAppReady()).toBe(false);
  });
});
