import { expect, test, type Page } from '@playwright/test';

/**
 * Dane strukturalne w wyrenderowanym HTML (#313): Article. JobPosting — oferty demo go nie
 * emitują (#297), więc sprawdza go tests/e2e/job-posting-fixture.spec.ts.
 */
async function jsonLdOfType(page: Page, type: string): Promise<Record<string, unknown> | undefined> {
  return (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .find((item) => item['@type'] === type);
}

test('Article poradnika ma obraz marki, dateModified i logo wydawcy', async ({ page }) => {
  await page.goto('/pl/poradniki/praca-w-belgii-bez-znajomosci-jezyka');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const data = await jsonLdOfType(page, 'Article');
  expect(data).toBeTruthy();
  expect(data!.image).toEqual([new URL('/og.png', siteUrl).href]);
  expect(data!.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(data!.publisher).toMatchObject({ logo: { url: new URL('/icon-512.png', siteUrl).href } });

  const logo = await page.request.get('/icon-512.png');
  expect(logo.status()).toBe(200);
});
