import { expect, test } from '@playwright/test';

const locales = {
  pl: { title: 'Oferty', applications: 'Nowe aplikacje' },
  nl: { title: 'Vacatures', applications: 'Nieuwe sollicitaties' },
  fr: { title: 'Offres', applications: 'Nouvelles candidatures' },
  en: { title: 'Offers', applications: 'New applications' },
} as const;

for (const [locale, copy] of Object.entries(locales)) {
  test(`${locale}: oferty pracodawcy zachowują akcje i mieszczą się przy 320/640 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/oferty`);

    await expect(page.getByRole('heading', { level: 1, name: copy.title })).toBeVisible();
    const offers = page.getByRole('list', { name: copy.title });
    await expect(offers.getByRole('listitem')).toHaveCount(5);
    await expect(offers.locator('dt').filter({ hasText: copy.applications }).first()).toBeVisible();
    await expect(offers.getByRole('button').first()).toBeVisible();

    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )).toBeLessThanOrEqual(1);
    }
  });
}
