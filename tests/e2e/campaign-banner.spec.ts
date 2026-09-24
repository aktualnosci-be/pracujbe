import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Baner kampanii z oferty (#175, #186) na danych demo (bez bazy): danych demonstracyjnych nie
 * da się wyeksportować — endpoint zwraca 404, strona pokazuje „baner niedostępny”, a lista ofert
 * nie ma linku do baneru dla ofert demo. Odpowiedzi są prywatne i nieindeksowane.
 * Eksport z prawdziwej oferty i uprawnienia: tests/unit/campaign-banner-route.test.ts
 * i supabase/tests/rls.sql sekcja CJ186.
 */

const JOB_ID = '00000000-0000-4000-8000-000000000000';

type Copy = { campaignBanner: { pageTitle: string; unavailableTitle: string; openBanner: string } };

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Copy;
}

test('endpoint baneru: demo = 404, błędne parametry = 400, zawsze noindex i no-store', async ({ request }) => {
  for (const [query, status] of [
    ['format=1200x300&locale=pl', 404],
    ['format=300x600&locale=fr&download=1', 404],
    ['format=999x1&locale=pl', 400],
  ] as const) {
    const response = await request.get(`/api/employer/jobs/${JOB_ID}/banner?${query}`);
    expect(response.status(), query).toBe(status);
    expect(response.headers()['x-robots-tag']).toMatch(/noindex/);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(response.headers()['content-type'] ?? '').not.toMatch(/svg/);
  }
  // Demonstracyjna oferta z listy (id 12345) też nie daje grafiki.
  expect((await request.get('/api/employer/jobs/12345/banner')).status()).toBe(400);
});

for (const locale of LOCALES) {
  test(`strona baneru w trybie demo: komunikat „niedostępny”, bez podglądu (${locale})`, async ({ page }) => {
    const t = copy(locale).campaignBanner;
    await page.goto(`/${locale}/employer/oferty/${JOB_ID}/baner`);
    await expect(page.getByRole('heading', { level: 1, name: t.pageTitle })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t.unavailableTitle })).toBeVisible();
    await expect(page.locator('main img')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
}

test('lista ofert demo nie prowadzi do eksportu baneru', async ({ page }) => {
  await page.goto('/pl/employer/oferty');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(copy('pl').campaignBanner.openBanner) })).toHaveCount(0);
});
