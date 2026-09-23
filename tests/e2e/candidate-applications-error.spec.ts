import { expect, test } from '@playwright/test';

const copy = {
  pl: { title: 'Nie udało się wczytać danych', retry: 'Spróbuj ponownie' },
  nl: { title: 'Gegevens konden niet worden geladen', retry: 'Opnieuw proberen' },
  fr: { title: 'Impossible de charger les données', retry: 'Réessayer' },
  en: { title: 'Could not load your information', retry: 'Try again' },
} as const;

for (const [locale, text] of Object.entries(copy)) {
  test(`initial application read failure shows localized retry in ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}/candidate/aplikacje`);
    await expect(page.getByRole('alert').getByRole('heading', { name: text.title })).toBeVisible();
    const retry = page.getByRole('alert').getByRole('button', { name: text.retry });
    await expect(retry).toBeVisible();
    await page.waitForLoadState('networkidle');
    await retry.click();
    await expect(page.getByRole('alert').getByRole('heading', { name: text.title })).toBeVisible();
  });
}
