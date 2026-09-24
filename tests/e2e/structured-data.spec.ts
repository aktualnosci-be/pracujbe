import { expect, test, type Page } from '@playwright/test';

import plMessages from '../../src/messages/pl.json';

/** Dane strukturalne w wyrenderowanym HTML (#313): JobPosting i Article. */
async function jsonLdOfType(page: Page, type: string): Promise<Record<string, unknown> | undefined> {
  return (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .find((item) => item['@type'] === type);
}

test('JobPosting ma pełny opis HTML i validThrough tylko z realnej daty wygaśnięcia', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');
  const href = await page.locator('a[href*="/oferty-pracy/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);

  const data = await jsonLdOfType(page, 'JobPosting');
  expect(data).toBeTruthy();
  const description = String(data!.description);
  expect(description).toMatch(/^<p>/);
  expect(description).toContain(`<h3>${plMessages.job.requirementsMandatory}</h3><ul><li>`);
  // Dane demonstracyjne nie mają daty wygaśnięcia → pole pominięte, bez „datePosted + 60 dni”.
  expect(data).not.toHaveProperty('validThrough');
});

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
