import { expect, test } from '@playwright/test';

const CASES = [
  { locale: 'pl', consent: 'Tylko niezbędne', upload: 'Wgraj', remove: 'Usuń' },
  { locale: 'nl', consent: 'Alleen noodzakelijke', upload: 'Uploaden', remove: 'Verwijderen' },
  { locale: 'fr', consent: 'Uniquement nécessaires', upload: 'Téléverser', remove: 'Supprimer' },
  { locale: 'en', consent: 'Only necessary', upload: 'Upload', remove: 'Delete' },
] as const;

for (const { locale, consent, upload, remove } of CASES) {
  test(`przycisk CV: ${locale}, ekran 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate/profil`);
    await page.getByRole('button', { name: consent }).click();

    const uploadButton = page.getByRole('button', { name: upload, exact: true });
    const box = await uploadButton.boundingBox();
    expect(box, 'Przycisk przesyłania CV powinien być widoczny i mierzalny.').not.toBeNull();
    expect(box!.height, 'Główna akcja przesyłania CV powinna mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);

    await expect(page.getByText('CV-Mateusz-Kowalski.pdf', { exact: true })).toBeVisible();
    const removeButton = page.getByRole('button', {
      name: `${remove}: CV-Mateusz-Kowalski.pdf`,
      exact: true,
    });
    const removeBox = await removeButton.boundingBox();
    expect(removeBox, 'Przycisk usunięcia CV powinien być widoczny i mierzalny.').not.toBeNull();
    expect(removeBox!.width, 'Przycisk usunięcia CV powinien mieć co najmniej 48 px szerokości.').toBeGreaterThanOrEqual(48);
    expect(removeBox!.height, 'Przycisk usunięcia CV powinien mieć co najmniej 48 px wysokości.').toBeGreaterThanOrEqual(48);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, 'Profil kandydata nie powinien przewijać się poziomo.').toBeLessThanOrEqual(1);
  });
}
