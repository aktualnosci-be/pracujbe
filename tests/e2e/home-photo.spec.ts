import { expect, test } from '@playwright/test';

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`fotograficzny home: ${locale}, mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}`);
    const photo = page.locator('main img[src*="team.webp"]');
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (locale === 'pl') {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: 'test-results/home-photo-desktop.png' });
    }
  });
}
