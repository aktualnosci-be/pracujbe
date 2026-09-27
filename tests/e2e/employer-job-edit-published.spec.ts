import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { waitForHydrated } from './fixtures/hydration';

type Messages = {
  dashboard: Record<string, string>;
  jobWizard: Record<string, string>;
};

const messages = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf8'),
) as Messages;
const d = messages.dashboard;
const w = messages.jobWizard;

test('opublikowaną ofertę można poprawić bez zmiany statusu (#325)', async ({ page }) => {
  await page.goto('/pl/employer/oferty');
  const main = page.getByRole('main');

  // Demo: „Operator wózka widłowego" jest aktywna — ma „Edytuj" obok akcji cyklu życia.
  const edit = main.getByRole('link', {
    name: d.editJobLabel!.replace('{title}', 'Operator wózka widłowego'),
    exact: true,
  });
  await expect(edit).toBeVisible();
  await edit.click();

  await expect(page.getByRole('heading', { level: 1, name: w.editTitle })).toBeVisible();
  await expect(page.getByText(w.editSubtitleActive!)).toBeVisible();
  // Kroki nie zapisują się pojedynczo — nie ma „Zapisz i wyjdź".
  await expect(page.getByRole('button', { name: w.saveExit })).toHaveCount(0);

  const title = page.getByLabel(w.titleLabel!);
  await expect(title).toHaveValue('Operator wózka widłowego');
  await waitForHydrated(title);
  await title.fill('Operator wózka widłowego – zmiana nocna');

  // „Dalej" tylko waliduje; zapis całości z dowolnego kroku.
  await page.getByRole('button', { name: w.next }).click();
  await expect(page.getByRole('heading', { level: 2, name: w.step2Title })).toBeFocused();
  await page.getByRole('button', { name: w.saveChanges }).click();
  await expect(page.getByRole('status')).toHaveText(w.editSavedDemo!);
});

test('kontrola ujemna: pusty tytuł blokuje zapis i przenosi do kroku 1 (#325)', async ({ page }) => {
  await page.goto('/pl/employer/oferty/12345/edycja');
  const title = page.getByLabel(w.titleLabel!);
  // Wpis przed hydratacją ginie (React przywraca tytuł z serwera) i kreator przechodzi dalej.
  await waitForHydrated(title);
  await title.fill('');
  await page.getByRole('button', { name: w.next }).click();
  // Krok 1 nie przepuszcza dalej z pustym tytułem.
  await expect(page.getByRole('heading', { level: 2, name: w.step1Title })).toBeVisible();

  await page.getByRole('button', { name: w.saveChanges }).click();
  await expect(page.getByRole('alert').filter({ hasText: w.step1Title! })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});
