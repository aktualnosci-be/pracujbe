import { expect, test } from '@playwright/test';

/**
 * Każda strona uwierzytelniania ma dokładnie jeden nagłówek poziomu 1 (tytuł karty), dzięki
 * czemu czytnik ekranu od razu ogłasza cel strony (WCAG 1.3.1 / 2.4.6).
 */

const pages = [
  '/logowanie',
  '/rejestracja',
  '/rejestracja-pracodawca',
  '/reset-hasla',
  '/ustaw-nowe-haslo',
  '/potwierdzenie',
  '/potwierdz-email',
];

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  for (const path of pages) {
    test(`jeden h1 z tytułem strony: /${locale}${path}`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      const headings = page.getByRole('heading', { level: 1 });
      await expect(headings).toHaveCount(1);
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(/\S{2,}/);
    });
  }
}
