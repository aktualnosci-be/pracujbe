import { existsSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// next-intl/middleware nie ładuje się w Vitest; przekierowanie działa przed nim.
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});

import middleware from '@/middleware';

/**
 * K4 (gotowość do startu): dawna atrapa `/faq` z treścią placeholder zniknęła obok realnej
 * `/pomoc` (#61). Stare adresy (zakładki, indeks) dostają 308 na `/pomoc` w tym samym języku.
 */
const ORIGIN = 'https://pracuj.be';

function run(path: string) {
  return middleware(new NextRequest(new URL(path, ORIGIN)));
}

describe('/faq → /pomoc', () => {
  for (const locale of ['pl', 'nl', 'fr', 'en']) {
    it(`/${locale}/faq: 308 na /${locale}/pomoc`, async () => {
      const res = await run(`/${locale}/faq`);
      expect(res.status).toBe(308);
      expect(new URL(res.headers.get('location') ?? '').pathname).toBe(`/${locale}/pomoc`);
    });
  }

  it('ukośnik na końcu i query zostają obsłużone', async () => {
    const res = await run('/nl/faq/?utm_source=x');
    expect(res.status).toBe(308);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/nl/pomoc');
    expect(location.search).toBe('?utm_source=x');
  });

  it('kontrola ujemna: nieobsługiwany język i inne trasy bez przekierowania na /pomoc', async () => {
    for (const path of ['/de/faq', '/pl/faq/cos', '/pl/pomoc', '/pl/faqs']) {
      const res = await run(path);
      expect(res.headers.get('location') ?? '').not.toMatch(/\/pomoc$/);
    }
  });

  it('strona-atrapa nie istnieje (inaczej wróciłaby treść placeholder)', () => {
    expect(existsSync('src/app/[locale]/(public)/faq/page.tsx')).toBe(false);
  });
});
