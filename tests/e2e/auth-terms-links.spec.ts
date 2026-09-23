import { expect, test } from '@playwright/test';

/**
 * #229: zgoda przy rejestracji linkuje do istniejących stron regulaminu i polityki prywatności
 * w bieżącym języku (nowa karta, żeby nie gubić danych), a klik w link nie przełącza checkboxa.
 */

const pages = ['rejestracja', 'rejestracja-pracodawca'] as const;
const locales = ['pl', 'nl', 'fr', 'en'] as const;

for (const locale of locales) {
  for (const slug of pages) {
    test(`/${locale}/${slug}: zgoda zawiera linki do regulaminu i polityki`, async ({ page }) => {
      await page.goto(`/${locale}/${slug}`);
      const consent = page.locator('label[for="agreeTerms"]');
      for (const path of ['regulamin', 'polityka-prywatnosci']) {
        const link = consent.locator(`a[href="/${locale}/${path}"]`);
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
      }
    });
  }
}

test('klik w link regulaminu otwiera nową kartę i nie zaznacza zgody', async ({ page, context }) => {
  await page.goto('/pl/rejestracja');
  const checkbox = page.getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('label[for="agreeTerms"] a[href="/pl/regulamin"]').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).pathname).toBe('/pl/regulamin');
  await popup.close();

  await expect(page).toHaveURL(/\/pl\/rejestracja$/);
  await expect(checkbox).not.toBeChecked();

  // Tekst etykiety poza linkiem nadal przełącza zgodę.
  await page.locator('label[for="agreeTerms"]').click({ position: { x: 2, y: 2 } });
  await expect(checkbox).toBeChecked();
});
