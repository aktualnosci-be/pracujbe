import { expect, test } from '@playwright/test';

test('akcje propozycji są mobilne i nie udają zapisu w trybie demo', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/candidate/propozycje');

  const cookieButton = page.getByRole('button', { name: 'Tylko niezbędne' });
  if (await cookieButton.isVisible()) await cookieButton.click();

  const accept = page.getByRole('button', { name: 'Przyjmij propozycję' });
  const decline = page.getByRole('button', { name: 'Odrzuć propozycję' });
  await expect(accept).toHaveCount(1);
  await expect(decline).toHaveCount(1);

  for (const button of [accept, decline]) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  const card = accept.locator('xpath=ancestor::li[1]');
  await expect(card).toContainText('sent');
  await accept.click();

  await expect(page.getByText('Coś poszło nie tak. Spróbuj ponownie.')).toBeVisible();
  await expect(card).toContainText('sent');
  await expect(accept).toBeEnabled();
  await expect(page).toHaveURL('/pl/candidate/propozycje');
});
