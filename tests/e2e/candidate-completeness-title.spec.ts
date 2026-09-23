import { expect, test } from '@playwright/test';

const goodLevels = {
  pl: 'Dobry poziom',
  nl: 'Goed niveau',
  fr: 'Bon niveau',
  en: 'Good level',
} as const;

for (const [locale, goodLevel] of Object.entries(goodLevels)) {
  test(`pusty profil kandydata nie dostaje pochwały na pulpicie ani w profilu (${locale})`, async ({ page }) => {
    for (const route of ['candidate', 'candidate/profil']) {
      await page.goto(`/${locale}/${route}`);
      await expect(page.getByText('0%', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(goodLevel, { exact: true })).toHaveCount(0);
    }
  });
}
