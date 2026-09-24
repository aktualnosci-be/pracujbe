import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Invariant #9 (#374): KAŻDA strona paneli (candidate/employer/admin) i auth ma meta robots
 * `noindex`. Lista tras powstaje z `src/app/[locale]/**\/page.tsx`, więc nowa podstrona jest
 * objęta automatycznie. W produkcji nie ma globalnego X-Robots-Tag — chroni wyłącznie meta.
 *
 * Sprawdzamy HTML odpowiedzi serwera (bez renderowania w przeglądarce), bo to on trafia do
 * robotów wyszukiwarek — i tak jest szybciej niż pełne `page.goto` na ~120 adresach.
 */

const APP = join(process.cwd(), 'src', 'app', '[locale]');
/** Segment dynamiczny: identyfikator, którego nie ma w danych demo (404 też musi być noindex). */
const DYNAMIC_ID = '00000000-0000-4000-8000-000000000000';

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

/** `src/app/[locale]/(auth)/logowanie/page.tsx` → `/logowanie`; grupy `( )` pomijane. */
function routeOf(file: string): string {
  const segments = relative(APP, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map((segment) => (/^\[.+\]$/.test(segment) ? DYNAMIC_ID : segment));
  return `/${segments.join('/')}`;
}

const ROUTES = [
  ...['candidate', 'employer', 'admin'].flatMap((panel) => pages(join(APP, panel))),
  ...pages(join(APP, '(auth)')),
]
  .map(routeOf)
  .sort();

test('lista tras z systemu plików obejmuje panele i auth', () => {
  expect(ROUTES).toEqual(
    expect.arrayContaining(['/admin/firmy', '/candidate/aplikacje', '/employer/oferty/nowa', '/logowanie', '/reset-hasla']),
  );
  expect(ROUTES.length).toBeGreaterThanOrEqual(30);
});

for (const locale of LOCALES) {
  test(`meta robots noindex na wszystkich stronach paneli i auth (${locale})`, async ({ request }) => {
    const indexable: string[] = [];
    for (const route of ROUTES) {
      const url = `/${locale}${route}`;
      const response = await request.get(url, { maxRedirects: 0 });
      // Tryb demo renderuje panele bez sesji. Przekierowanie dopuszczamy wyłącznie do innej trasy
      // panelu (np. wyłączone płatności → pulpit), która sama jest na tej liście; każde inne
      // oznaczałoby niesprawdzoną stronę. 404 (segment dynamiczny) też musi mieć noindex.
      if (response.status() >= 300 && response.status() < 400) {
        const target = new URL(response.headers()['location'] ?? '', 'http://localhost').pathname;
        expect(target, `${url} przekierowuje poza panel`).toMatch(new RegExp(`^/${locale}/(candidate|employer|admin)(/|$)`));
        continue;
      }
      expect([200, 404], url).toContain(response.status());
      const html = await response.text();
      const robots = [...html.matchAll(/<meta[^>]+name="robots"[^>]*>/g)].map((m) => m[0]);
      if (!robots.some((tag) => /content="[^"]*noindex/.test(tag))) indexable.push(`${url} → ${robots.join(' ') || 'brak meta robots'}`);
    }
    expect(indexable, 'strony paneli/auth bez noindex').toEqual([]);
  });
}
