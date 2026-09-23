import { expect, test, type Page } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

/**
 * Kreator oferty w jawnym trybie demo: krok 9 rozdziela „Zapisz i wyjdź” (szkic, bez zgody na
 * publikację — #193) od „Opublikuj” (zgoda wymagana). Test nie dowodzi zapisu do PostgreSQL —
 * to pokrywa walidacja akcji serwera w testach jednostkowych.
 */
const locales = { pl, nl, fr, en } as const;
type Messages = typeof pl;

async function addChip(page: Page, m: Messages, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.locator('..').getByRole('button', { name: m.jobWizard.add, exact: true }).click();
}

async function fillToStep9(page: Page, m: Messages): Promise<void> {
  const t = m.jobWizard;
  const next = page.getByRole('button', { name: t.next, exact: true });

  await page.getByLabel(t.titleLabel).fill('Operator magazynu');
  await page.getByRole('combobox', { name: t.categoryLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.occupationLabel).fill('Magazynier');
  await next.click();

  await page.getByRole('combobox', { name: t.contractTypeLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.workingHoursLabel).fill('38 h');
  await next.click();

  await page.getByLabel(t.cityLabel).fill('Antwerpen');
  await page.getByLabel(t.regionLabel).fill('Vlaanderen');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step4Title })).toBeVisible();
  await next.click();

  await page
    .getByLabel(t.descriptionLabel)
    .fill('Kompletowanie zamówień w magazynie centralnym w spokojnym zespole.');
  await addChip(page, m, t.responsibilitiesLabel, 'Kompletowanie zamówień');
  await next.click();

  await addChip(page, m, t.requirementsMandatoryLabel, 'Dokładność');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step7Title })).toBeVisible();
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step8Title })).toBeVisible();
  await next.click();

  await expect(page.getByRole('heading', { level: 2, name: t.step9Title })).toBeVisible();
  await page.getByLabel(t.companyDescriptionLabel).fill('Rodzinna firma logistyczna z Antwerpii.');
}

for (const [locale, m] of Object.entries(locales)) {
  test.describe(`krok 9 kreatora oferty: ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/${locale}/employer/oferty/nowa`);
      await page.getByRole('button', { name: m.cookies.rejectOptional }).click();
      await fillToStep9(page, m);
    });

    test('„Zapisz i wyjdź” działa bez zgody na publikację', async ({ page }) => {
      const consent = page.getByRole('checkbox', { name: m.jobWizard.agreePublish });
      await expect(consent).not.toBeChecked();

      await page.getByRole('button', { name: m.jobWizard.saveExit, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`/${locale}/employer/?$`));
    });

    test('„Opublikuj” bez zgody zostaje na kroku i wskazuje pole zgody', async ({ page }) => {
      const consent = page.getByRole('checkbox', { name: m.jobWizard.agreePublish });

      const publish = page.getByRole('button', { name: m.jobWizard.publish, exact: true });
      await publish.focus();
      await page.keyboard.press('Enter');

      await expect(consent).toBeFocused();
      await expect(consent).toHaveAttribute('aria-invalid', 'true');
      await expect(consent).toHaveAttribute('aria-describedby', 'job-agreePublish-error');
      await expect(page.locator('#job-agreePublish-error')).toHaveText(
        m.job.error.publishAgreementRequired,
      );
      await expect(page).toHaveURL(new RegExp(`/${locale}/employer/oferty/nowa`));
    });
  });
}

test('za długa pozycja listy jest odrzucana z komunikatem przy polu (#364)', async ({ page }) => {
  const t = pl.jobWizard;
  await page.goto('/pl/employer/oferty/nowa');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  await page.getByLabel(t.titleLabel).fill('Operator magazynu');
  await page.getByRole('combobox', { name: t.categoryLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.occupationLabel).fill('Magazynier');
  const next = page.getByRole('button', { name: t.next, exact: true });
  await next.click();
  await page.getByRole('combobox', { name: t.contractTypeLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.workingHoursLabel).fill('38 h');
  await next.click();
  await page.getByLabel(t.cityLabel).fill('Antwerpia');
  await page.getByLabel(t.regionLabel).fill('Flandria');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step4Title })).toBeVisible();
  await next.click();

  const input = page.getByLabel(t.responsibilitiesLabel, { exact: true });
  const long = 'x'.repeat(501);
  await addChip(page, pl, t.responsibilitiesLabel, long);

  await expect(input).toHaveValue(long);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAttribute('aria-describedby', 'job-responsibilities-draft-error');
  await expect(page.locator('#job-responsibilities-draft-error')).toHaveText(
    t.itemTooLongMax.replace('{max}', '500'),
  );
  await expect(page.getByRole('button', { name: `${t.remove}: ${long}` })).toHaveCount(0);
});
