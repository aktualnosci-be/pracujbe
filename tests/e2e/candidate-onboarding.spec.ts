import { expect, test } from '@playwright/test';

const localizedWizard = [
  { locale: 'pl', title: 'Twój profil kandydata', firstName: 'Imię', lastName: 'Nazwisko', error: 'Podaj nazwisko.', next: 'Dalej: Preferencje pracy' },
  { locale: 'nl', title: 'Je kandidatenprofiel', firstName: 'Voornaam', lastName: 'Achternaam', error: 'Vul je achternaam in.', next: 'Volgende: Werkvoorkeuren' },
  { locale: 'fr', title: 'Votre profil de candidat', firstName: 'Prénom', lastName: 'Nom', error: 'Indiquez votre nom.', next: "Suivant: Préférences d'emploi" },
  { locale: 'en', title: 'Your candidate profile', firstName: 'First name', lastName: 'Last name', error: 'Enter your last name.', next: 'Next: Job preferences' },
] as const;

for (const { locale, title, firstName, lastName, error, next } of localizedWizard) {
  for (const width of [320, 640]) {
    test(`kreator ${locale} przy ${width} px: błąd i fokus`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}/candidate/onboarding`);
      await page.locator('[aria-labelledby="cookie-banner-title"] button').first().click();

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.locator('main').locator('..')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      const name = page.getByLabel(firstName, { exact: true });
      await name.fill('Anna');
      await page.getByRole('button', { name: next }).click();
      const invalidField = page.getByLabel(lastName, { exact: true });
      await expect(page.getByText(error)).toBeVisible();
      await expect(invalidField).toHaveAttribute('aria-invalid', 'true');
      await expect(invalidField).toBeFocused();
      await expect(name).toHaveValue('Anna');
      await expect(page.getByRole('navigation', { name: /1.*6/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    });
  }
}

async function expectMinimumTarget(
  locator: import('@playwright/test').Locator,
  minimum = 24,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, 'Cel akcji powinien być widoczny i mierzalny.').not.toBeNull();
  expect(box!.width, `Szerokość celu powinna wynosić co najmniej ${minimum}px.`).toBeGreaterThanOrEqual(
    minimum,
  );
  expect(box!.height, `Wysokość celu powinna wynosić co najmniej ${minimum}px.`).toBeGreaterThanOrEqual(
    minimum,
  );
}

/**
 * Kliencki przepływ kreatora profilu kandydata w jawnym trybie demo.
 *
 * Ten test dowodzi walidacji i zachowania stanu w zamontowanym komponencie. Nie dowodzi
 * zapisu do bazy, ponownego wczytania profilu ani działania RPC `finish_onboarding`.
 */
test('kreator zachowuje dane klienta i przechodzi przez sześć kroków', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/candidate/onboarding');

  await page.getByRole('button', { name: 'Tylko niezbędne' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Twój profil kandydata' })).toBeVisible();

  // Krok 1: błąd walidacji nie czyści poprawnie wpisanego imienia.
  await page.getByLabel('Imię').fill('Anna');
  await page.getByRole('button', { name: /Dalej: Preferencje pracy/ }).click();
  await expect(page.getByText('Podaj nazwisko.')).toBeVisible();
  await expect(page.getByLabel('Imię')).toHaveValue('Anna');

  await page.getByLabel('Nazwisko').fill('Kowalska');
  await page.getByLabel('Numer telefonu').fill('+32 470 12 34 56');
  await page.getByRole('button', { name: /Dalej: Preferencje pracy/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Preferencje pracy' })).toBeVisible();
  await expectMinimumTarget(page.getByRole('button', { name: 'Zamknij' }));

  // Krok 2: zawód i branża.
  await page.getByLabel('Zawody i stanowiska').fill('Magazynier');
  await page.getByRole('button', { name: 'Dodaj' }).click();
  await page.getByRole('button', { name: 'Magazyn', exact: true }).click();
  await page.getByRole('button', { name: /Dalej: Doświadczenie i umiejętności/ }).click();

  // Krok 3: wymagane jest doświadczenie; umiejętności są opcjonalne.
  await page.getByLabel('Lata doświadczenia').fill('4');
  await page.getByRole('button', { name: /Dalej: Lokalizacja i mobilność/ }).click();

  // Krok 4: lokalizacja; wartości domyślne mobilności pozostają poprawne.
  await page.getByLabel('Miasto zamieszkania').fill('Antwerpen');
  await page.getByRole('button', { name: /Dalej: Języki i certyfikaty/ }).click();

  // Krok 5: małe akcje usunięcia pozostają wygodnym celem dotykowym.
  await page.getByPlaceholder('np. niderlandzki').fill('Niderlandzki');
  await page.getByRole('button', { name: 'Dodaj język' }).click();
  await expectMinimumTarget(page.getByRole('button', { name: 'Usuń: Niderlandzki' }));
  await page.getByPlaceholder('np. VCA, świadectwo kwalifikacji').fill('VCA');
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expectMinimumTarget(page.getByRole('button', { name: 'Usuń: VCA' }));

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    horizontalOverflow,
    'Kreator nie powinien przewijać się poziomo przy 320 px.',
  ).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /Dalej: Preferencje i podsumowanie/ }).click();

  // Krok 6: wymagane są dostępność i zgoda.
  await page.getByLabel('Dostępność').click();
  await page.getByRole('option', { name: 'Od zaraz' }).click();
  await page.getByRole('checkbox', { name: /^Akceptuję regulamin/ }).click();

  // Powrót sprawdza wyłącznie stan zamontowanego komponentu (bez reloadu i bez dowodu DB).
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Języki i certyfikaty' })).toBeVisible();
  await page.getByRole('button', { name: /Dalej: Preferencje i podsumowanie/ }).click();
  await expect(page.getByLabel('Dostępność')).toHaveText('Od zaraz');
  await expect(page.getByRole('checkbox', { name: /^Akceptuję regulamin/ })).toBeChecked();

  await page.getByRole('button', { name: 'Zakończ i opublikuj' }).click();
  await expect(page).toHaveURL(/\/pl\/candidate$/);
  await expect(page.getByRole('heading').first()).toBeVisible();
});
