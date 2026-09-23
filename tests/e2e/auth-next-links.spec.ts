import { expect, test } from '@playwright/test';

/**
 * Parametr powrotu (`?next=`) przeżywa przejście logowanie ↔ rejestracja, ale tylko gdy jest
 * bezpieczną ścieżką w serwisie. Wartość zewnętrzna jest pomijana (brak open redirect).
 */

const offer = '/pl/oferty-pracy/murarz-bruksela-1002';

test('logowanie przenosi bezpieczny next do linku rejestracji', async ({ page }) => {
  await page.goto(`/pl/logowanie?next=${encodeURIComponent(offer)}`);
  const href = await page.locator('main a[href^="/pl/rejestracja?"]').getAttribute('href');
  expect(new URL(href ?? '', 'http://x').searchParams.get('next')).toBe(offer);
});

test('rejestracja przenosi bezpieczny next do linku logowania', async ({ page }) => {
  await page.goto(`/pl/rejestracja?next=${encodeURIComponent(offer)}`);
  const href = await page.locator('main a[href^="/pl/logowanie?"]').getAttribute('href');
  expect(new URL(href ?? '', 'http://x').searchParams.get('next')).toBe(offer);
});

for (const bad of ['https://evil.example/pl', '//evil.example/pl']) {
  test(`zewnętrzny next (${bad}) nie trafia do linków`, async ({ page }) => {
    await page.goto(`/pl/logowanie?next=${encodeURIComponent(bad)}`);
    await expect(page.locator('main a[href*="evil.example"]')).toHaveCount(0);
    await expect(page.locator('main a[href="/pl/rejestracja"]')).toHaveCount(1);
  });
}
