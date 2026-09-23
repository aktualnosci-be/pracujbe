import { expect, test } from '@playwright/test';

/** Pracodawca bez konta dochodzi z logowania do swojej rejestracji jednym kliknięciem. */
for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`logowanie linkuje do rejestracji pracodawcy (${locale})`, async ({ page, request }) => {
    await page.goto(`/${locale}/logowanie`);
    const link = page.locator(`main a[href="/${locale}/rejestracja-pracodawca"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(/\S{3,}/);
    const response = await request.get(`/${locale}/rejestracja-pracodawca`);
    expect(response.status()).toBe(200);
  });
}
