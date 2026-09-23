import { expect, test } from '@playwright/test';

for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`lista rozmów paszport: ${role}, ${locale}, 320 px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(`/${locale}/${role}/wiadomosci`);

      const list = page.locator('aside').getByRole('list');
      await expect(list).toBeVisible();
      await expect(list.getByRole('link').first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      const firstLink = list.getByRole('link').first();
      expect((await firstLink.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    });
  }
}
