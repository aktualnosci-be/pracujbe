// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1035: ścieżki z jednym segmentem z kropką w korzeniu (`/brak-takiego-pliku.png`) trafiają
 * teraz do middleware (przechodzi bramka hasła i gotowość), ale zachowują stary routing: bez
 * next-intl (brak przekierowania pod prefiks języka), więc 404 powłoki zostaje wielojęzyczny.
 * Adresy z prefiksem języka i segmentami z kropką nadal idą przez next-intl.
 */
const intl = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('next-intl/middleware', () => ({ default: () => intl.handler }));

import middleware from '@/middleware';
import { SITE_ACCESS_COOKIE, siteAccessToken } from '@/lib/site-access';

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://pracuj.example${path}`, { headers });

beforeEach(() => {
  intl.handler.mockReset();
  intl.handler.mockImplementation(() => NextResponse.next());
});
afterEach(() => vi.unstubAllEnvs());

describe('middleware: dotted segment w korzeniu (#1035)', () => {
  it.each(['/brak-takiego-pliku.png', '/foo.bar', '/plik.xml/'])('%s omija next-intl (bez przekierowania)', async (path) => {
    const res = await middleware(request(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(intl.handler).not.toHaveBeenCalled();
  });

  it.each(['/pl/oferty-pracy/praca.magazyn', '/nl/pracodawcy/firma.be', '/xx', '/pl'])(
    'kontrola ujemna: %s nadal przechodzi przez next-intl',
    async (path) => {
      await middleware(request(path));
      expect(intl.handler).toHaveBeenCalledTimes(1);
    },
  );

  it('bramka hasła obejmuje także te ścieżki (nie da się jej ominąć kropką)', async () => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', 'tajne-haslo-123');
    const denied = await middleware(request('/brak-takiego-pliku.png'));
    expect(denied.status).toBe(503);
    expect(denied.headers.get('x-robots-tag')).toContain('noindex');

    const token = await siteAccessToken('tajne-haslo-123');
    const ok = await middleware(request('/brak-takiego-pliku.png', { cookie: `${SITE_ACCESS_COOKIE}=${token}` }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(intl.handler).not.toHaveBeenCalled();
  });
});
