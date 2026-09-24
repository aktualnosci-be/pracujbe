import { expect, test, type Page } from '@playwright/test';

import pl from '../../src/messages/pl.json';

/**
 * #101 — pytania screeningowe w kroku 7 kreatora (tryb demo: zapis nie trafia do bazy —
 * zapis, atomowość i blokadę po publikacji dowodzi `rls.sql` sekcja SQ101).
 * - puste pytanie i pusta opcja → komunikat przy polu, `aria-invalid`, fokus na pierwszym błędzie;
 * - poprawne pytania przepuszczają do kroku 8;
 * - kolejność zmienia się przyciskami;
 * - opublikowana oferta: pytania tylko do odczytu (baza zmienia je wyłącznie w szkicu).
 */
const t = pl.jobWizard;

async function addChip(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.locator('..').getByRole('button', { name: t.add, exact: true }).click();
}

async function goToStep7(page: Page): Promise<void> {
  const next = page.getByRole('button', { name: t.next, exact: true });
  await page.getByLabel(t.titleLabel).fill('Kierowca C+E');
  await page.getByRole('combobox', { name: t.categoryLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.occupationLabel).fill('Kierowca');
  await next.click();
  await page.getByRole('combobox', { name: t.contractTypeLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.workingHoursLabel).fill('40 h');
  await next.click();
  await page.getByLabel(t.cityLabel).fill('Gandawa');
  await page.getByLabel(t.regionLabel).fill('Flandria');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step4Title })).toBeVisible();
  await next.click();
  await page.getByLabel(t.descriptionLabel).fill('Transport międzynarodowy z bazy w Gandawie, stałe trasy.');
  await addChip(page, t.responsibilitiesLabel, 'Przewóz ładunków');
  await next.click();
  await addChip(page, t.requirementsMandatoryLabel, 'Prawo jazdy C+E');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step7Title })).toBeVisible();
}

const promptLabel = t.screeningPrompt.replace('{language}', 'Polski');
const optionLabel = (n: number) => t.screeningOption.replace('{n}', String(n)).replace('{language}', 'Polski');

test('pytania screeningowe: błędy przy polach, kolejność i przejście dalej', async ({ page }) => {
  await page.goto('/pl/employer/oferty/nowa');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  await goToStep7(page);

  await expect(page.getByRole('heading', { level: 3, name: t.screeningTitle })).toBeVisible();
  const add = page.getByRole('button', { name: t.screeningAdd });
  await add.click();
  await add.click();

  const first = page.getByTestId('screening-question-1');
  const second = page.getByTestId('screening-question-2');
  await second.getByRole('combobox', { name: t.screeningType }).click();
  await page.getByRole('option', { name: t.screeningTypeSingleChoice }).click();
  await expect(second.getByLabel(optionLabel(2), { exact: true })).toBeVisible();

  // Kontrola ujemna: puste pytanie i pusta opcja nie przechodzą; fokus na pierwszym błędzie.
  await page.getByRole('button', { name: t.next, exact: true }).click();
  const firstPrompt = first.getByLabel(promptLabel, { exact: true });
  await expect(firstPrompt).toHaveAttribute('aria-invalid', 'true');
  await expect(firstPrompt).toBeFocused();
  await expect(first.getByText(pl.job.error.screeningPromptRequired)).toBeVisible();
  await expect(second.getByLabel(optionLabel(1), { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(second.getByText(pl.job.error.screeningOptionRequired).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: t.step7Title })).toBeVisible();

  await firstPrompt.fill('Czy masz kartę kierowcy?');
  await first.getByRole('checkbox', { name: t.screeningRequired }).check();
  await second.getByLabel(promptLabel, { exact: true }).fill('Jak dojedziesz do bazy?');
  await second.getByLabel(optionLabel(1), { exact: true }).fill('Własnym samochodem');
  await second.getByLabel(optionLabel(2), { exact: true }).fill('Komunikacją');

  // Kolejność: drugie pytanie na górę.
  await page.getByRole('button', { name: t.screeningMoveUp.replace('{n}', '2') }).click();
  await expect(first.getByLabel(promptLabel, { exact: true })).toHaveValue('Jak dojedziesz do bazy?');
  await expect(second.getByLabel(promptLabel, { exact: true })).toHaveValue('Czy masz kartę kierowcy?');

  await page.getByRole('button', { name: t.next, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: t.step8Title })).toBeVisible();
});

test('opublikowana oferta: pytania tylko do odczytu (#101)', async ({ page }) => {
  await page.goto('/pl/employer/oferty/12345/edycja');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  const next = page.getByRole('button', { name: t.next, exact: true });
  for (let step = 1; step < 7; step += 1) await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step7Title })).toBeVisible();

  await expect(page.getByTestId('screening-read-only')).toHaveText(t.screeningReadOnly);
  await expect(page.getByRole('button', { name: t.screeningAdd })).toHaveCount(0);
});
