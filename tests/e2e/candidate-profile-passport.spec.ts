import { expect, test } from '@playwright/test';

const titles = {
  pl: 'Twój profil zawodowy',
  en: 'Your work profile',
  fr: 'Votre profil professionnel',
  nl: 'Je werkprofiel',
} as const;

for (const [locale, title] of Object.entries(titles)) {
  for (const width of [320, 640]) {
    test(`paszport profilu ${locale} mieści się przy ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}/candidate/profil`);

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expect(page.locator(`a[href="/${locale}/candidate/onboarding"]`).first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'Profil nie powinien wymagać przewijania w poziomie.').toBeLessThanOrEqual(1);
    });
  }
}
