import { expect, test } from '@playwright/test';

import { AxeBuilder } from './fixtures/axe';
import { LOCALES, messages } from './fixtures/messages';

/**
 * Strukturalne świadczenia oferty (#826, migracja 0976 — numer tymczasowy): filtr listy bez
 * JavaScriptu (powtórzony klucz `benefits` → CSV w adresie), chipy z usuwaniem jednego
 * świadczenia, sekcja „Świadczenia” na szczególe oferty. Dane demo (bez bazy).
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const JOB_SLUG = 'bricklayer-brussels-1002';

for (const locale of LOCALES) {
  test(`bez JavaScriptu: świadczenia przechodzą przez adres i zawężają listę (${locale})`, async ({ browser }) => {
    const m = messages(locale);
    const benefits = (m as unknown as { jobBenefits: Record<string, string> }).jobBenefits;
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.goto(`/${locale}/oferty-pracy`);
    const form = page.locator('[data-filter-passport="no-js"]');
    await expect(form).toBeVisible();
    await form.getByRole('checkbox', { name: benefits['eco_vouchers'], exact: true }).check();
    await form.getByRole('checkbox', { name: benefits['hospital_insurance'], exact: true }).check();
    await form.locator('button[type="submit"]').click();
    await page.waitForLoadState('domcontentloaded');

    // Formularz GET wysyła powtórzony klucz; strona łączy go w jeden filtr (`flattenSearchParams`).
    expect(new URL(page.url()).searchParams.getAll('benefits')).toEqual(['eco_vouchers', 'hospital_insurance']);
    const again = page.locator('[data-filter-passport="no-js"]');
    await expect(again.getByRole('checkbox', { name: benefits['eco_vouchers'], exact: true })).toBeChecked();
    await expect(again.getByRole('checkbox', { name: benefits['company_car'], exact: true })).not.toBeChecked();

    // Chip usuwa jedno świadczenie, drugie zostaje (link działa bez JS).
    const chip = page.getByRole('link', {
      name: new RegExp(`${m.filters.removeFilter}: ${benefits['hospital_insurance']!.replace(/[()]/g, '\\$&')}`),
    });
    await expect(chip).toHaveCount(1);
    await chip.click();
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).searchParams.get('benefits')).toBe('eco_vouchers');
    await context.close();
  });

  test(`szczegół oferty: sekcja „Świadczenia” w języku strony (${locale})`, async ({ page }) => {
    const m = messages(locale);
    const benefits = (m as unknown as { jobBenefits: Record<string, string> }).jobBenefits;
    const job = (m as unknown as { job: Record<string, string> }).job;
    await page.goto(`/${locale}/oferty-pracy/${JOB_SLUG}`);
    const section = page.getByTestId('job-benefits');
    await expect(page.getByRole('heading', { name: job['benefitsTitle'], exact: true })).toBeVisible();
    for (const code of ['meal_vouchers', 'eco_vouchers', 'hospital_insurance', 'year_end_bonus']) {
      await expect(section.locator(`[data-benefit="${code}"]`)).toHaveText(benefits[code]!);
    }
    // Kontrola ujemna: świadczenie niezaznaczone przez pracodawcę nie jest pokazywane.
    await expect(section.locator('[data-benefit="company_car"]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('[data-testid="job-benefits"]').withTags(WCAG).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
}
