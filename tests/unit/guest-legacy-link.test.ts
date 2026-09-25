import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// next-intl/middleware nie ładuje się w Vitest (ESM `next/server`); odrzucenie działa przed nim.
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});

import middleware from '@/middleware';

/**
 * #505: link gościa z tokenem w query (format sprzed #506) nie jest przyjmowany — token
 * w query trafia do logów pierwszego żądania. Middleware zwraca czysty URL i nie zapisuje
 * tokenu w cookie; strona pokazuje „link nieprawidłowy”. Nowe linki mają token we fragmencie.
 */
const ORIGIN = 'https://pracuj.be';
const VALID = 'A'.repeat(43);

async function run(path: string, cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return middleware(new NextRequest(new URL(path, ORIGIN), { headers }));
}

describe('#505 stare linki gościa z ?token=', () => {
  for (const path of ['/pl/aplikacja/potwierdz', '/en/aplikacja/przejmij', '/nl/aplikacja/przejmij/']) {
    it(`${path}: 303 na czysty adres, token nie trafia do cookie`, async () => {
      const res = await run(`${path}?token=${VALID}&utm_source=mail`);
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.pathname).toBe(path);
      expect(location.search).toBe('');
      expect(res.headers.get('location')).not.toContain(VALID);
      // Poprawny format tokenu mimo to NIE jest wymieniany na cookie (kontrola ujemna do
      // dawnego zachowania, które ustawiało pb_guest_* z wartością z query).
      expect(res.headers.get('set-cookie') ?? '').not.toContain(VALID);
      expect(res.cookies.getAll()).toEqual([]);
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    });
  }

  it('powtórzony parametr i zły format — to samo odrzucenie', async () => {
    for (const query of [`token=${VALID}&token=${VALID}`, 'token=x', 'token=']) {
      const res = await run(`/pl/aplikacja/potwierdz?${query}`);
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location') ?? '').search).toBe('');
      expect(res.cookies.getAll()).toEqual([]);
    }
  });

  it('cookie z nowego linku (fragment) zostaje nietknięte', async () => {
    const res = await run(`/pl/aplikacja/potwierdz?token=${VALID}`, `pb_guest_confirm=${'B'.repeat(43)}`);
    expect(res.status).toBe(303);
    expect(res.cookies.get('pb_guest_confirm')).toBeUndefined();
  });

  it('inne trasy z parametrem token nie są przekierowywane', async () => {
    const res = await run(`/pl/oferty-pracy?token=${VALID}`);
    expect(res.status).not.toBe(303);
  });
});
