import { expect, test } from '@playwright/test';

const CASES = [
  { locale: 'pl', consent: 'Tylko niezbędne', upload: 'Wgraj' },
  { locale: 'nl', consent: 'Alleen noodzakelijke', upload: 'Uploaden' },
  { locale: 'fr', consent: 'Uniquement nécessaires', upload: 'Téléverser' },
  { locale: 'en', consent: 'Only necessary', upload: 'Upload' },
] as const;

for (const { locale, consent, upload } of CASES) {
  test(`przycisk CV: ${locale}, ekran 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate/profil`);
    await page.getByRole('button', { name: consent }).click();

    const uploadButton = page.getByRole('button', { name: upload, exact: true });
    const box = await uploadButton.boundingBox();
    expect(box, 'Przycisk przesyłania CV powinien być widoczny i mierzalny.').not.toBeNull();
    expect(box!.height, 'Główna akcja przesyłania CV powinna mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, 'Profil kandydata nie powinien przewijać się poziomo.').toBeLessThanOrEqual(1);
  });
}
