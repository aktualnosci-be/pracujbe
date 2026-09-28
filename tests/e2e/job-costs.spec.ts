import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';
import { AxeBuilder } from './fixtures/axe';

/**
 * „Koszty i dodatki” (0930) w jawnym trybie demo: sekcja szczegółu oferty (dane przykładowe
 * oferty 1001) w czterech językach z linkiem do oficjalnej bazy stawek minimalnych, oraz pola
 * kroku 8 kreatora (szczegóły mieszkania tylko przy zakwaterowaniu zapewnionym, błąd przy polu
 * kwoty; publikacja z zakwaterowaniem zapewnionym wymaga kosztu i potrącenia — 28.09.2026). Zapis do PostgreSQL dowodzi `rls.sql` sekcja CB930, mapowanie — `job-costs.test.ts`.
 */
const locales = { pl, nl, fr, en } as const;
const DEMO_JOB = '/oferty-pracy/warehouse-worker-antwerp-1001';
const MINIMUM_WAGES = {
  pl: 'https://www.minimumlonen.be/jc_overview.html',
  nl: 'https://www.minimumlonen.be/jc_overview.html',
  fr: 'https://www.salairesminimums.be/jc_overview.html',
  en: 'https://www.minimumlonen.be/jc_overview.html',
} as const;

for (const [locale, m] of Object.entries(locales) as [keyof typeof locales, typeof pl][]) {
  test(`szczegół oferty: sekcja kosztów i dodatków (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}${DEMO_JOB}`);
    await page.getByRole('button', { name: m.cookies.rejectOptional }).click();

    const section = page.getByTestId('job-costs');
    await expect(page.getByRole('heading', { level: 2, name: m.job.costsTitle })).toBeVisible();
    await expect(section.locator('[data-cost-item="accommodation"] dd')).toContainText(m.job.costs.kind.provided);
    await expect(section.locator('[data-cost-item="accommodation"] dd')).toContainText(m.job.costs.deductedYes);
    await expect(section.locator('[data-cost-item="transport"] dd')).toHaveText(m.job.costs.shuttle);
    await expect(section.locator('[data-cost-item="mealVouchers"] dt')).toHaveText(m.job.mealVouchers);
    const committee = section.locator('[data-cost-item="jointCommittee"] dd');
    await expect(committee).toContainText(m.job.costs.committeeCode.replace('{code}', '322'));
    await expect(committee.getByRole('link', { name: m.job.costs.minimumWagesLink })).toHaveAttribute(
      'href',
      MINIMUM_WAGES[locale],
    );
    await expect(page.getByText(m.job.costsDeclared)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[data-testid="job-costs"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
}

test('kreator, krok 8: szczegóły mieszkania tylko przy zakwaterowaniu zapewnionym, błąd kwoty przy polu', async ({ page }) => {
  const t = pl.jobWizard;
  await page.goto('/pl/employer/oferty/nowa');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
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
  await page.getByLabel(t.descriptionLabel).fill('Kompletowanie zamówień w magazynie centralnym w spokojnym zespole.');
  const resp = page.getByLabel(t.responsibilitiesLabel, { exact: true });
  await resp.fill('Kompletowanie zamówień');
  await resp.locator('..').getByRole('button', { name: t.add, exact: true }).click();
  await next.click();
  const req = page.getByLabel(t.requirementsMandatoryLabel, { exact: true });
  await req.fill('Dokładność');
  await req.locator('..').getByRole('button', { name: t.add, exact: true }).click();
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step7Title })).toBeVisible();
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step8Title })).toBeVisible();

  const costField = page.getByLabel(t.accommodationCostLabel);
  await expect(costField).toHaveCount(0);
  await page.getByRole('combobox', { name: t.accommodationKindLabel }).click();
  await page.getByRole('option', { name: t.accommodationKind.assistance }).click();
  await expect(costField).toHaveCount(0);
  await page.getByRole('combobox', { name: t.accommodationKindLabel }).click();
  await page.getByRole('option', { name: t.accommodationKind.provided }).click();
  await expect(costField).toBeVisible();

  await costField.fill('12,345');
  await page.getByRole('checkbox', { name: t.transportShuttle }).check();
  await page.getByRole('combobox', { name: t.jointCommitteeLabel }).click();
  await page.getByRole('option', { name: /^PC 124 — / }).click();
  const results = await new AxeBuilder({ page })
    .include('[data-testid="job-costs-fieldset"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  await next.click();
  await expect(page.getByText(pl.job.error.accommodationCostInvalid)).toBeVisible();
  await expect(costField).toHaveAttribute('aria-invalid', 'true');

  await costField.fill('120,50');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step9Title })).toBeVisible();

  // Decyzja właściciela 28.09.2026: szkic przeszedł bez informacji o potrąceniu, ale publikacja
  // wraca do kroku 8 z błędem przy polu „potrącany z wynagrodzenia”.
  await page.getByLabel(t.companyDescriptionLabel).fill('Firma logistyczna z Antwerpii, magazyn centralny.');
  await page.getByRole('checkbox', { name: t.agreePublish }).check();
  const publish = page.getByRole('button', { name: t.publish, exact: true });
  await publish.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step8Title })).toBeVisible();
  await expect(page.getByRole('alert').filter({
    hasText: t.publishFixStep.replace('{step}', '8').replace('{title}', t.step8Title),
  })).toBeVisible();
  await expect(page.getByText(pl.job.error.accommodationDeductedRequired)).toBeVisible();
  const deducted = page.getByRole('combobox', { name: t.accommodationDeductedLabel });
  await expect(deducted).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/pl\/employer\/oferty\/nowa/);

  await deducted.click();
  await page.getByRole('option', { name: t.tri.no, exact: true }).click();
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step9Title })).toBeVisible();
  await publish.click();
  await expect(page).toHaveURL(/\/pl\/employer$/);
});
