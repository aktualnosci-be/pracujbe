import { expect, test } from '@playwright/test';

const labels = {
  pl: 'Przejdź do treści',
  nl: 'Ga naar de inhoud',
  fr: 'Aller au contenu',
  en: 'Skip to content',
} as const;

for (const [locale, label] of Object.entries(labels)) {
  test(`odnośnik do treści działa dla języka ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);

    const skipLink = page.getByRole('link', { name: label });
    await expect(skipLink).toBeAttached();
    await expect(skipLink).not.toBeInViewport();

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/${locale}/?#main-content$`));
  });
}
