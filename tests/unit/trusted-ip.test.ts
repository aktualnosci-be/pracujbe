// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ipInCidr, isCloudflareEdgeIp, trustedClientIp, trustedProxyHeaderName } from '@/lib/http/trusted-ip';

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

  it('konfiguracja Cloudflare: żądanie z brzegu Cloudflare → CF-Connecting-IP, a nie X-Real-IP', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    const h = new Headers({ 'x-real-ip': '172.70.1.2', 'cf-connecting-ip': '203.0.113.7' });
    expect(trustedClientIp(h)).toBe('203.0.113.7');
  });

  it('rażąco długa wartość nagłówka odrzucona (obrona w głąb)', () => {
    const h = new Headers({ 'x-real-ip': '1'.repeat(200) });
    expect(trustedClientIp(h)).toBeNull();
  });
});

describe('trustedClientIp — CF-Connecting-IP tylko od Cloudflare (#1090)', () => {
  it('żądanie z pominięciem Cloudflare: sfałszowany CF-Connecting-IP ignorowany, liczy się peer', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    const h = new Headers({ 'x-real-ip': '198.51.100.9', 'cf-connecting-ip': '203.0.113.7' });
    expect(trustedClientIp(h)).toBe('198.51.100.9');
  });

  it('peer z IPv6 Cloudflare → CF-Connecting-IP', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    const h = new Headers({ 'x-real-ip': '2a06:98c1:3120::3', 'cf-connecting-ip': '2001:db8::5' });
    expect(trustedClientIp(h)).toBe('2001:db8::5');
  });

  it('połączenie z Cloudflare bez CF-Connecting-IP → null (adres brzegu nie jest klientem)', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    expect(trustedClientIp(new Headers({ 'x-real-ip': '104.16.0.1' }))).toBeNull();
  });

  it('brak peera (X-Real-IP) → null, nawet z CF-Connecting-IP', () => {
    vi.stubEnv('TRUSTED_PROXY_HEADER', 'cf-connecting-ip');
    expect(trustedClientIp(new Headers({ 'cf-connecting-ip': '203.0.113.7' }))).toBeNull();
  });

  it('kontrola ujemna: tryb x-real-ip nigdy nie czyta CF-Connecting-IP', () => {
    const h = new Headers({ 'x-real-ip': '104.16.0.1', 'cf-connecting-ip': '203.0.113.7' });
    expect(trustedClientIp(h)).toBe('104.16.0.1');
  });
});

describe('ipInCidr / isCloudflareEdgeIp', () => {
  it.each([
    ['173.245.48.1', true], ['173.245.63.255', true], ['173.245.64.0', false], ['162.159.255.255', true],
    ['10.0.0.1', false], ['::ffff:104.16.0.9', true], ['2606:4700:10::6816:1', true],
    ['2606:4701::1', false], ['2a06:98c7:ffff::1', true], ['2a06:98c8::1', false],
    ['nie-adres', false], ['1.2.3.4.5', false], ['256.1.1.1', false], ['2606:4700:::1', false],
  ])('%s → %s', (ip, expected) => {
    expect(isCloudflareEdgeIp(ip)).toBe(expected);
  });

  it('IPv4 nie pasuje do zakresu IPv6 i odwrotnie; zły prefiks = false', () => {
    expect(ipInCidr('104.16.0.1', '2400:cb00::/32')).toBe(false);
    expect(ipInCidr('2400:cb00::1', '104.16.0.0/13')).toBe(false);
    expect(ipInCidr('104.16.0.1', '104.16.0.0/33')).toBe(false);
    expect(ipInCidr('104.16.0.1', '104.16.0.0/x')).toBe(false);
    expect(ipInCidr('0.0.0.0', '0.0.0.0/0')).toBe(true);
  });
});
