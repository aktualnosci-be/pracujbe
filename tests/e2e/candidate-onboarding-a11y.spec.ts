import { expect, test, type Page } from '@playwright/test';

/**
 * Dostępność kreatora profilu kandydata (tryb demo, bez dowodu zapisu do DB):
 * - #323: po zmianie kroku fokus trafia na nagłówek nowego kroku, a krok jest ogłaszany,
 * - #320: pola z błędem wskazują komunikat przez `aria-describedby`, fokus na pierwszym błędzie,
 * - #337: zgoda w kroku 6 linkuje do regulaminu i polityki, a „Zapisz i wyjdź” nie wymaga zgody.
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;

async function openWizard(page: Page, locale: string): Promise<void> {
  await page.goto(`/${locale}/candidate/onboarding`);
  await page.locator('[aria-labelledby="cookie-banner-title"] button').first().click();
}

/** Przycisk „Dalej: <krok>” — jedyny przycisk kreatora ze strzałką w prawo (niezależnie od języka). */
function nextButton(page: Page) {
  return page.getByRole('button').filter({ has: page.locator('svg.lucide-arrow-right') });
}

/** Wypełnia kroki 1–5 poprawnymi danymi (niezależnie od języka — po id pól). */
async function goToStep6(page: Page): Promise<void> {
  await page.locator('#onb-firstName').fill('Anna');
  await page.locator('#onb-lastName').fill('Kowalska');
  await nextButton(page).click();
  await page.locator('#onb-occupations').fill('Magazynier');
  await page.locator('#onb-occupations').press('Enter');
  await page.locator('#onb-categories button').first().click();
  await nextButton(page).click();
  await page.locator('#onb-experienceYears').fill('4');
  await nextButton(page).click();
  await page.locator('#onb-city').fill('Antwerpen');
  await nextButton(page).click();
  await nextButton(page).click();
  await expect(page.locator('#onb-agreeTerms-box')).toBeVisible();
}

/** Każdy id z `aria-describedby` wskazuje istniejący, widoczny element. */
async function expectDescribedBy(page: Page, selector: string, id: string, text?: string): Promise<void> {
  const field = page.locator(selector);
  await expect(field).toHaveAttribute('aria-describedby', new RegExp(`(^| )${id}( |$)`));
  const target = page.locator(`#${id}`);
  await expect(target).toBeVisible();
  if (text) await expect(target).toHaveText(text);
}

test('#323: „Dalej” z klawiatury przenosi fokus na nagłówek kroku i ogłasza krok', async ({ page }) => {
  await openWizard(page, 'pl');
  const heading1 = page.getByRole('heading', { level: 2, name: 'Dane podstawowe' });
  // Przy pierwszym wejściu nic nie jest ogłaszane i fokus nie jest przejmowany.
  await expect(heading1).not.toBeFocused();

  await page.locator('#onb-firstName').fill('Anna');
  await page.locator('#onb-lastName').fill('Kowalska');
  await page.locator('#onb-phone').fill('+32 470 12 34 56');
  await nextButton(page).focus();
  await page.keyboard.press('Enter');

  const heading2 = page.getByRole('heading', { level: 2, name: 'Preferencje pracy' });
  await expect(heading2).toBeFocused();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Krok 2 z 6' })).toHaveText(
    'Krok 2 z 6: Preferencje pracy',
  );

  await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(heading1).toBeFocused();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Krok 1 z 6' })).toHaveText(
    'Krok 1 z 6: Dane podstawowe',
  );
});

test('#320: błędy są powiązane z polami, fokus na pierwszym błędnym polu', async ({ page }) => {
  await openWizard(page, 'pl');
  // Podpowiedź telefonu jest powiązana zawsze, nie tylko przy błędzie.
  await expectDescribedBy(page, '#onb-phone', 'onb-phone-hint');
  await expect(page.locator('#onb-firstName')).not.toHaveAttribute('aria-describedby', /.+/);

  await nextButton(page).click();
  await expect(page.locator('#onb-firstName')).toBeFocused();
  await expect(page.locator('#onb-firstName')).toHaveAttribute('aria-invalid', 'true');
  await expectDescribedBy(page, '#onb-firstName', 'onb-firstName-error', 'Podaj imię.');
  await expectDescribedBy(page, '#onb-lastName', 'onb-lastName-error');

  // Krok 2: pole chipów i grupa branż wskazują swoje błędy.
  await page.locator('#onb-firstName').fill('Anna');
  await page.locator('#onb-lastName').fill('Kowalska');
  await nextButton(page).click();
  await nextButton(page).click();
  await expect(page.locator('#onb-occupations')).toBeFocused();
  await expectDescribedBy(page, '#onb-occupations', 'onb-occupations-error', 'Dodaj co najmniej jeden zawód.');
  await expectDescribedBy(page, '#onb-occupations', 'onb-occupations-hint');
  const categories = page.getByRole('group', { name: 'Branże' });
  await expect(categories).toHaveAttribute('id', 'onb-categories');
  await expectDescribedBy(page, '#onb-categories', 'onb-categories-error');
});

test('#320: w kroku 6 fokus trafia do grupy z błędem (dostępność), a potem do zgody', async ({ page }) => {
  await openWizard(page, 'pl');
  await goToStep6(page);

  await page.getByRole('button', { name: 'Zakończ i opublikuj' }).click();
  await expect(page.locator('#onb-availability-trigger')).toBeFocused();
  await expectDescribedBy(page, '#onb-availability-trigger', 'onb-availability-error', 'Wybierz swoją dostępność.');

  await page.locator('#onb-availability-trigger').click();
  await page.getByRole('option', { name: 'Od zaraz' }).click();
  await page.getByRole('button', { name: 'Zakończ i opublikuj' }).click();
  await expect(page.locator('#onb-agreeTerms-box')).toBeFocused();
  await expectDescribedBy(
    page,
    '#onb-agreeTerms-box',
    'onb-agreeTerms-error',
    'Musisz zaakceptować regulamin i politykę prywatności.',
  );
  await expect(page).toHaveURL(/\/pl\/candidate\/onboarding$/);
});

test('#337: „Zapisz i wyjdź” w kroku 6 nie wymaga zgody', async ({ page }) => {
  await openWizard(page, 'pl');
  await goToStep6(page);
  await page.locator('#onb-availability-trigger').click();
  await page.getByRole('option', { name: 'Od zaraz' }).click();
  await expect(page.locator('#onb-agreeTerms-box')).not.toBeChecked();

  await page.getByRole('button', { name: 'Zapisz i wyjdź' }).click();
  await expect(page).toHaveURL(/\/pl\/candidate$/);
});

for (const locale of locales) {
  test(`#337 /${locale}: zgoda w kroku 6 linkuje do regulaminu i polityki prywatności`, async ({ page }) => {
    await openWizard(page, locale);
    await goToStep6(page);
    const consent = page.locator('label[for="onb-agreeTerms-box"]');
    for (const path of ['regulamin', 'polityka-prywatnosci']) {
      const link = consent.locator(`a[href="/${locale}/${path}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
  });
}

test('#337: klik w link regulaminu otwiera nową kartę i nie zaznacza zgody', async ({ page, context }) => {
  await openWizard(page, 'pl');
  await goToStep6(page);
  const checkbox = page.locator('#onb-agreeTerms-box');

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('label[for="onb-agreeTerms-box"] a[href="/pl/regulamin"]').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).pathname).toBe('/pl/regulamin');
  await popup.close();

  await expect(checkbox).not.toBeChecked();
  await page.locator('label[for="onb-agreeTerms-box"]').click({ position: { x: 2, y: 2 } });
  await expect(checkbox).toBeChecked();
});
