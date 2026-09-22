import { expect, test } from '@playwright/test';

async function expectMinimumTarget(
  locator: import('@playwright/test').Locator,
  minimum = 24,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, 'Cel akcji powinien być widoczny i mierzalny.').not.toBeNull();
  expect(
    box!.width,
    `Szerokość celu powinna wynosić co najmniej ${minimum}px.`,
  ).toBeGreaterThanOrEqual(minimum);
  expect(
    box!.height,
    `Wysokość celu powinna wynosić co najmniej ${minimum}px.`,
  ).toBeGreaterThanOrEqual(minimum);
}

/**
 * Kliencki przepływ kreatora oferty w jawnym trybie demo.
 *
 * Test potwierdza rozmiary małych akcji na ekranie 320 px. Nie dowodzi zapisu
 * szkicu do PostgreSQL ani publikacji oferty przez konto pracodawcy.
 */
test('małe akcje kreatora oferty mają dostępny cel dotykowy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/employer/oferty/nowa');
  await page.getByRole('button', { name: 'Tylko niezbędne' }).click();

  await page.getByLabel('Tytuł oferty').fill('Operator magazynu');
  await page.getByLabel('Kategoria').click();
  await page.getByRole('option', { name: 'Magazyn' }).click();
  await page.getByLabel('Zawód').fill('Magazynier');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expectMinimumTarget(page.getByRole('button', { name: 'Zamknij' }));
  await page.getByRole('button', { name: 'Zamknij' }).click();

  await page.getByLabel('Rodzaj umowy').click();
  await page.getByRole('option', { name: 'Umowa na stałe' }).click();
  await page.getByLabel('Godziny pracy').fill('Pełny etat');
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.getByLabel('Miasto').fill('Antwerpia');
  await page.getByLabel('Region').fill('Flandria');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page
    .getByLabel('Opis stanowiska')
    .fill(
      'Praca w spokojnym zespole przy kompletowaniu zamówień magazynowych.',
    );
  const responsibilityInput = page.getByPlaceholder(
    'np. Obsługa wózka widłowego',
  );
  await responsibilityInput.fill('Kompletowanie zamówień');
  await responsibilityInput
    .locator('..')
    .getByRole('button', { name: 'Dodaj', exact: true })
    .click();
  await expectMinimumTarget(
    page.getByRole('button', { name: 'Usuń: Kompletowanie zamówień' }),
  );
  await page.getByRole('button', { name: 'Dalej' }).click();

  const mandatoryInput = page.getByPlaceholder(
    'np. Uprawnienia na wózki widłowe',
  );
  await mandatoryInput.fill('Dokładność');
  await mandatoryInput
    .locator('..')
    .getByRole('button', { name: 'Dodaj', exact: true })
    .click();
  await page.getByRole('button', { name: 'Dalej' }).click();

  await page.getByPlaceholder('np. Niderlandzki').fill('Niderlandzki');
  await page.getByRole('button', { name: 'Dodaj język' }).click();
  await expectMinimumTarget(
    page.getByRole('button', { name: 'Usuń: Niderlandzki' }),
  );
});
