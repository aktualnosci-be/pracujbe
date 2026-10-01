// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { deviceLabelFromUserAgent, isAllowedPushEndpoint, PUSH_ENDPOINT_PATTERNS } from '@/lib/push/endpoint';

/**
 * #724 — endpoint subskrypcji tylko z listy dozwolonych usług push (ochrona przed SSRF: serwer
 * wysyła żądanie na adres podany przez przeglądarkę). Lista TS = lista w `push_endpoint_allowed`
 * (0983) 1:1; kontrole ujemne: adres wewnętrzny, host z dozwolonym prefiksem, port, http,
 * dane logowania, host w ścieżce, znaki sterujące.
 */

const MIGRATION = readFileSync('supabase/migrations/0983_web_push_subscriptions.sql', 'utf8');

describe('lista dozwolonych usług push', () => {
  it('wzorce TS = wzorce funkcji SQL (jedno źródło reguły)', () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf('function public.push_endpoint_allowed'),
      MIGRATION.indexOf('$$;', MIGRATION.indexOf('function public.push_endpoint_allowed')),
    );
    const sql = [...fn.matchAll(/p_endpoint ~ '([^']+)'/g)].map((m) => m[1]);
    const ts = PUSH_ENDPOINT_PATTERNS.map((re) => re.source.replace(/\\\//g, '/'));
    expect(sql).toEqual(ts);
    expect(sql.length).toBe(4);
  });

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
    'https://web.push.apple.com/QGvUo1ABCdef',
  ])('dozwolony: %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/fcm/send/abcdefgh',
    'https://fcm.googleapis.com.evil.be/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'http://fcm.googleapis.com/fcm/send/abcdef',
    'https://user@fcm.googleapis.com/fcm/send/abc',
    'https://evil.be/push.apple.com/abcdefgh',
    'https://FCM.googleapis.com/fcm/send/abcdef',
    'https://fcm.googleapis.com/fcm/send/a\nb',
    'https://fcm.googleapis.com/fcm/send/a b',
    `https://fcm.googleapis.com/${'a'.repeat(2048)}`,
  ])('odrzucony: %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('kontrola ujemna: wejście inne niż tekst', () => {
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint({ toString: () => 'https://fcm.googleapis.com/x/abcdef' })).toBe(false);
  });
});

describe('etykieta urządzenia (bez pełnego User-Agent)', () => {
  it('przeglądarka · system', () => {
    expect(
      deviceLabelFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'),
    ).toBe('Chrome · Android');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox · Windows');
    expect(
      deviceLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    ).toBe('Safari · iOS');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge · Windows');
  });

  it('kontrola ujemna: nierozpoznany albo brak nagłówka = brak etykiety (nie zapisujemy surowego UA)', () => {
    expect(deviceLabelFromUserAgent('curl/8.0')).toBeNull();
    expect(deviceLabelFromUserAgent(null)).toBeNull();
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/1 Safari/1')!.length).toBeLessThanOrEqual(60);
  });
});
