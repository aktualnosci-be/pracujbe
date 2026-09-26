// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { trustedClientIp, trustedProxyHeaderName } from '@/lib/http/trusted-ip';

/**
 * #588/#602 — jedyne źródło zaufanego IP klienta dla receiptów zgody, aplikacji bez konta
 * i limitera. `X-Forwarded-For` NIGDY nie jest źródłem: klient dopisuje go jako pierwszy,
 * więc bez jawnej konfiguracji liczby hopów nie da się bezpiecznie wybrać segmentu.
 */

afterEach(() => vi.unstubAllEnvs());

describe('trustedProxyHeaderName', () => {
  it('domyślnie x-real-ip (Railway)', () => {
    expect(trustedProxyHeaderName()).toBe('x-real-ip');
  });

  it('jawna konfiguracja cf-connecting-ip (Cloudflare przed Railway)', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    expect(trustedProxyHeaderName()).toBe('cf-connecting-ip');
  });

  it('nieznana wartość konfiguracji wraca do domyślnej (literówka nie wyłącza odczytu)', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'x-forwarded-for');
    expect(trustedProxyHeaderName()).toBe('x-real-ip');
  });
});

describe('trustedClientIp', () => {
  it('czyta X-Real-IP, gdy to skonfigurowany zaufany nagłówek', () => {
    const h = new Headers({ 'x-real-ip': '203.0.113.7' });
    expect(trustedClientIp(h)).toBe('203.0.113.7');
  });

  it('kontrola ujemna: sfałszowany X-Forwarded-For sam w sobie nie daje adresu', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' });
    expect(trustedClientIp(h)).toBeNull();
  });

  it('X-Forwarded-For obok zaufanego nagłówka jest ignorowany (klient nie może go podmienić)', () => {
    const h = new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' });
    expect(trustedClientIp(h)).toBe('203.0.113.7');
  });

  it('brak jakiegokolwiek nagłówka → null', () => {
    expect(trustedClientIp(new Headers())).toBeNull();
  });

  it('pusta wartość nagłówka → null', () => {
    expect(trustedClientIp(new Headers({ 'x-real-ip': '   ' }))).toBeNull();
  });

  it('konfiguracja Cloudflare czyta CF-Connecting-IP, a nie X-Real-IP', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    const h = new Headers({ 'x-real-ip': '198.51.100.9', 'cf-connecting-ip': '203.0.113.7' });
    expect(trustedClientIp(h)).toBe('203.0.113.7');
  });

  it('rażąco długa wartość nagłówka odrzucona (obrona w głąb)', () => {
    const h = new Headers({ 'x-real-ip': '1'.repeat(200) });
    expect(trustedClientIp(h)).toBeNull();
  });
});
