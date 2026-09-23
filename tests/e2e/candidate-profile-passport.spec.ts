import { expect, test } from '@playwright/test';

const titles = {
  pl: 'Twój profil zawodowy',
  en: 'Your work profile',
  fr: 'Votre profil professionnel',
  nl: 'Je werkprofiel',
} as const;
const emptyFields = { pl: 'Jeszcze nie podano', en: 'Not added yet', fr: 'Pas encore indiqué', nl: 'Nog niet ingevuld' } as const;
const emptyNames = { pl: 'Imię niepodane', en: 'First name not added', fr: 'Prénom non indiqué', nl: 'Geen voornaam opgegeven' } as const;

for (const [locale, title] of Object.entries(titles)) {
  for (const width of [320, 640]) {
    test(`paszport profilu ${locale} mieści się przy ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}/candidate/profil`);

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      const identity = page.getByTestId('candidate-identity');
      await expect(identity.getByRole('heading', { level: 2, name: emptyNames[locale as keyof typeof emptyNames] })).toBeVisible();
      await expect(identity).not.toContainText('Od zaraz');
      await expect(identity).not.toContainText('Michał Kowalski');
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expect(page.locator(`a[href="/${locale}/candidate/onboarding"]`).first()).toBeVisible();
      await expect(page.getByText(emptyFields[locale as keyof typeof emptyFields]).first()).toBeVisible();
      await expect(page.getByText('0%', { exact: true }).first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'Profil nie powinien wymagać przewijania w poziomie.').toBeLessThanOrEqual(1);

      const box = await identity.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    });
  }
}
