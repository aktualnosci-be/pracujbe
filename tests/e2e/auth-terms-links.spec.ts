import { expect, test } from '@playwright/test';

/**
 * #229/#493: pola przy rejestracji linkują do istniejących stron regulaminu i polityki prywatności
 * w bieżącym języku (nowa karta, żeby nie gubić danych), a klik w link nie przełącza checkboxa.
 */

const pages = ['rejestracja', 'rejestracja-pracodawca'] as const;
const locales = ['pl', 'nl', 'fr', 'en'] as const;

for (const locale of locales) {
  for (const slug of pages) {
    test(`/${locale}/${slug}: regulamin i informacja o prywatności mają osobne pola z linkami`, async ({ page }) => {
      await page.goto(`/${locale}/${slug}`);
      const pairs = [
        ['agreeTerms', 'regulamin', 'polityka-prywatnosci'],
        ['privacyNoticeAck', 'polityka-prywatnosci', 'regulamin'],
      ] as const;
      for (const [id, own, other] of pairs) {
        const label = page.locator(`label[for="${id}"]`);
        const link = label.locator(`a[href="/${locale}/${own}"]`);
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
        await expect(label.locator(`a[href="/${locale}/${other}"]`)).toHaveCount(0);
      }
    });
  }
}

test('klik w link regulaminu otwiera nową kartę i nie zaznacza zgody', async ({ page, context }) => {
  await page.goto('/pl/rejestracja');
  // Na rejestracji kandydata są kilka pól wyboru (deklaracja wieku #492, zgody #493) — bierzemy regulamin.
  const checkbox = page.locator('#agreeTerms');
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
