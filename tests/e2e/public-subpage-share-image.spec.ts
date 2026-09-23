import { expect, test, type Page } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const staticPaths = [
  '/praca',
  '/praca/kategoria/construction',
  '/praca/miasto/brussels',
  '/poradniki',
  '/poradniki/praca-w-belgii-bez-znajomosci-jezyka',
] as const;

async function expectBrandImageMetadata(page: Page, shareImage: string): Promise<void> {
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', shareImage);
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', shareImage);
}

for (const locale of locales) {
  for (const path of [...staticPaths, '/oferty-pracy/[slug]'] as const) {
    test(`strona ${locale}${path} udostępnia własne metadane i obraz marki`, async ({ page, request }) => {
      let route = `/${locale}${path}`;
      if (path === '/oferty-pracy/[slug]') {
        await page.goto(`/${locale}/oferty-pracy`);
        const href = await page.locator('a[href*="/oferty-pracy/"]').first().getAttribute('href');
        expect(href, 'Lista powinna prowadzić do oferty demonstracyjnej').toBeTruthy();
        route = href!;
      }

      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
      const canonical = new URL(route, siteUrl).href;
      const shareImage = new URL('/og.png', siteUrl).href;

      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /\S/);
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description).toMatch(/\S/);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!);
      await expectBrandImageMetadata(page, shareImage);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');

      const image = await request.get('/og.png');
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toMatch(/^image\/png/);
    });
  }
}

test('kontrola ujemna: brak obrazu OG jest wykrywany przez tę samą asercję', async ({ page }) => {
  await page.goto('/pl/praca');
  const shareImage = new URL('/og.png', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').href;
  await page.locator('meta[property="og:image"]').evaluate((element) => element.remove());
  await expect(expectBrandImageMetadata(page, shareImage)).rejects.toThrow();
});
