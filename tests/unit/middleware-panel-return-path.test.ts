// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1090 (AUTH-07): guardy paneli są layoutami i nie znają ścieżki żądania. Middleware podaje ją
 * next-intl w nagłówku żądania `x-pracujbe-return-path` (tylko dla stron paneli), a nagłówek
 * wysłany przez klienta zawsze usuwa — guard bez sesji kieruje na logowanie z powrotem na
 * otwieraną stronę.
 */
const intl = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('next-intl/middleware', () => ({ default: () => intl.handler }));

import middleware from '@/middleware';
import { PANEL_RETURN_PATH_HEADER, panelReturnPath } from '@/lib/auth/panel-return-path';

const HEADER = PANEL_RETURN_PATH_HEADER;

function seenHeader(): string | null {
  const req = intl.handler.mock.calls.at(-1)?.[0] as NextRequest | undefined;
  return req ? req.headers.get(HEADER) : null;
}

beforeEach(() => {
  intl.handler.mockReset();
  intl.handler.mockImplementation(() => NextResponse.next());
});

describe('middleware: ścieżka powrotu dla guardów paneli (#1090)', () => {
  it.each([
    '/pl/candidate/aplikacje/0b3c1f7e-7f38-4a55-9d1b-1d6f5b2f0a11',
    '/nl/employer/aplikacje?oferta=x',
    '/en/admin',
    '/fr/candidate/propozycje#x',
  ])('%s → nagłówek z tą ścieżką i query', async (path) => {
    await middleware(new NextRequest(`https://pracuj.example${path}`));
    expect(seenHeader()).toBe(path.replace(/#.*$/, ''));
  });

  it('nagłówek od klienta na stronie panelu jest zastąpiony prawdziwą ścieżką', async () => {
    await middleware(
      new NextRequest('https://pracuj.example/pl/employer', { headers: { [HEADER]: '/pl/admin/uzytkownicy' } }),
    );
    expect(seenHeader()).toBe('/pl/employer');
  });

  it.each(['/pl', '/pl/oferty-pracy?keyword=x', '/pl/logowanie', '/pl/candidates-fake', '/employer'])(
    'kontrola ujemna: %s (poza panelem) bez nagłówka, także gdy wysłał go klient',
    async (path) => {
      await middleware(new NextRequest(`https://pracuj.example${path}`, { headers: { [HEADER]: '/pl/candidate' } }));
      expect(seenHeader()).toBeNull();
    },
  );

  it('ciasteczka i metoda żądania docierają do next-intl bez zmian', async () => {
    await middleware(
      new NextRequest('https://pracuj.example/pl/candidate', { method: 'POST', headers: { cookie: 'NEXT_LOCALE=pl' } }),
    );
    const req = intl.handler.mock.calls.at(-1)?.[0] as NextRequest;
    expect(req.method).toBe('POST');
    expect(req.cookies.get('NEXT_LOCALE')?.value).toBe('pl');
    expect(req.nextUrl.pathname).toBe('/pl/candidate');
  });

  it('panelReturnPath: tylko segment panelu pod prefiksem języka', () => {
    expect(panelReturnPath('/pl/candidate', '')).toBe('/pl/candidate');
    expect(panelReturnPath('/pl/candidateX', '')).toBeNull();
    expect(panelReturnPath('/pl/oferty-pracy', '?a=1')).toBeNull();
  });
});
