import { expect, test } from '@playwright/test';

const headings = {
  pl: 'Zapisane oferty',
  nl: 'Bewaarde vacatures',
  fr: 'Offres enregistrées',
  en: 'Saved jobs',
} as const;

for (const [locale, heading] of Object.entries(headings)) {
  test(`saved jobs passport fits mobile in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate/zapisane`);

    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('li').filter({ has: page.locator('button[aria-pressed="true"]') }).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'Saved jobs should not cause horizontal scrolling.').toBeLessThanOrEqual(1);
  });
}
