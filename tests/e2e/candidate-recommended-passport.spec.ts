import { expect, test } from '@playwright/test';

const headings = {
  pl: 'Polecane oferty',
  nl: 'Aanbevolen vacatures',
  fr: 'Offres recommandées',
  en: 'Recommended jobs',
} as const;

for (const [locale, heading] of Object.entries(headings)) {
  for (const width of [320, 640]) {
    test(`paszport polecanych ofert ${locale} mieści się przy ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}/candidate/oferty-polecane`);

      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      const cards = page.getByRole('list', { name: heading }).getByRole('listitem');
      await expect(cards).toHaveCount(5);
      await expect(cards.first().getByRole('progressbar')).toBeVisible();
      await expect(cards.first().locator(`a[href^="/${locale}/oferty-pracy/"]`)).toBeVisible();

      const save = cards.first().locator('button[aria-pressed="false"]');
      await expect(save).toBeVisible();
      const box = await save.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'Karty nie powinny przewijać ekranu poziomo.').toBeLessThanOrEqual(1);
    });
  }
}
