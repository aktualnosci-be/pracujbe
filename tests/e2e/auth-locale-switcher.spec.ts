import { expect, test } from '@playwright/test';

/**
 * Strony uwierzytelniania mają przełącznik języka, który zachowuje ścieżkę i parametry zapytania.
 * Rejestracja zapisuje język strony jako preferred_locale (język e-maili, Invariant #1), więc
 * użytkownik musi móc go zmienić na miejscu.
 */

test('zmiana języka na rejestracji pracodawcy zachowuje stronę', async ({ page }) => {
  await page.goto('/nl/rejestracja-pracodawca');
  await page.getByRole('combobox', { name: 'Taal' }).click();
  await page.getByRole('option', { name: 'Français' }).click();
  await expect(page).toHaveURL(/\/fr\/rejestracja-pracodawca$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('combobox', { name: 'Langue' })).toBeVisible();
});

test('zmiana języka na logowaniu zachowuje parametry zapytania', async ({ page }) => {
  await page.goto('/pl/logowanie?error=AUTH_INVALID_CREDENTIALS');
  await page.getByRole('combobox', { name: 'Język' }).click();
  await page.getByRole('option', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/logowanie\?error=AUTH_INVALID_CREDENTIALS$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('zmiana języka na logowaniu przenosi cel powrotu (?next=) na nowy język', async ({ page }) => {
  await page.goto('/pl/logowanie?next=%2Fpl%2Foferty-pracy');
  await page.getByRole('combobox', { name: 'Język' }).click();
  await page.getByRole('option', { name: 'Nederlands' }).click();
  await expect(page).toHaveURL(/\/nl\/logowanie\?next=%2Fnl%2Foferty-pracy$/);
});

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`przełącznik mieści się przy 320 px bez poziomego przewijania (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/${locale}/rejestracja`);
    const switcher = page.locator('header').getByRole('combobox');
    await expect(switcher).toBeVisible();
    const box = await switcher.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
