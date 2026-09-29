// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1218: trasa prywatna (panele, auth) nie może oddać pełnego adresu (ścieżka + query) jako
 * `document.referrer` stronie publicznej otwartej z niej w nowej karcie — globalna polityka
 * `strict-origin-when-cross-origin` wysyła go w obrębie witryny, a beacon analityki na stronie
 * publicznej raportuje referrer dostawcy. Middleware ustawia `strict-origin` (sam origin) dla
 * tras prywatnych; jednorazowe linki zostają przy `no-referrer`; strony publiczne bez zmian.
 */
const intl = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('next-intl/middleware', () => ({ default: () => intl.handler }));

import middleware from '@/middleware';
import { allowsTrackingOnPath, isPrivateRoutePath } from '@/lib/analytics/route-policy';

const request = (path: string) => new NextRequest(`https://pracuj.example${path}`);

beforeEach(() => {
  intl.handler.mockReset();
  intl.handler.mockImplementation(() => NextResponse.next());
});

describe('middleware: Referrer-Policy tras prywatnych (#1218)', () => {
  it.each([
    '/pl/admin/oferty?q=fraza',
    '/pl/admin/uzytkownicy?q=jan%40example.com',
    '/en/admin/dziennik?actor=jan%40example.com',
    '/pl/candidate/aplikacje/0b3c1f7e-7f38-4a55-9d1b-1d6f5b2f0a11',
    '/nl/employer/aplikacje?oferta=x',
    '/fr/logowanie?next=%2Ffr%2Fcandidate',
    '/pl/rejestracja',
  ])('%s → strict-origin (bez ścieżki i query w referrerze)', async (path) => {
    const res = await middleware(request(path));
    expect(res.headers.get('referrer-policy')).toBe('strict-origin');
  });

  it.each(['/pl/wypisz', '/pl/ustaw-nowe-haslo', '/pl/aplikacja/potwierdz'])(
    'jednorazowy link %s zostaje przy no-referrer',
    async (path) => {
      const res = await middleware(request(path));
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  it.each(['/pl', '/pl/oferty-pracy?keyword=magazyn', '/nl/praca/miasto/antwerpen', '/pl/pomoc'])(
    'kontrola ujemna: strona publiczna %s bez nadpisania (polityka globalna z next.config)',
    async (path) => {
      const res = await middleware(request(path));
      expect(res.headers.get('referrer-policy')).toBeNull();
    },
  );

  it('polityka tras prywatnych nie jest no-referrer (Origin: null łamałby POST Server Actions)', async () => {
    const res = await middleware(request('/pl/employer'));
    expect(res.headers.get('referrer-policy')).not.toBe('no-referrer');
  });

  it('trasa prywatna = trasa bez analityki (jedno źródło listy)', () => {
    for (const path of ['/pl/admin', '/pl/candidate/zapisane', '/pl/oferty-pracy', '/pl', '/']) {
      expect(isPrivateRoutePath(path)).toBe(!allowsTrackingOnPath(path));
    }
  });

});
