import { expect, test } from '@playwright/test';

/**
 * Tryb demo zawiera prawdziwy rekord propozycji z warstwy danych. Test nie udaje odpowiedzi
 * backendu i nie dowodzi zachowania RLS; sprawdza jedynie renderowanie oraz dostępność bannera.
 */
test('pulpit pokazuje banner dla istniejącej propozycji i pozwala zamknąć go klawiaturą', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/candidate');

  const cookieButton = page.getByRole('button', { name: 'Tylko niezbędne' });
  if (await cookieButton.isVisible()) await cookieButton.click();

  const link = page.getByRole('link', { name: 'Zobacz ofertę' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /^\/pl\/oferty-pracy\//);

  const close = page.getByRole('button', { name: 'Zamknij' });
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeGreaterThanOrEqual(48);

  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(link).not.toBeVisible();
});
