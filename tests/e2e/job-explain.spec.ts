import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';
import { AxeBuilder } from './fixtures/axe';

/**
 * „Wyjaśnij ofertę” (#773) w jawnym trybie demo z atrapą dostawcy (`AI_JOB_EXPLAIN_PROVIDER=fixture`,
 * playwright.config.ts — bez sieci i kosztów; w `APP_MODE=production` atrapa jest ignorowana).
 * Treść oferty zostaje na stronie bez zmian, wyjaśnienie to osobna sekcja: wybór języka,
 * obsługa klawiaturą, fokus na wyniku, źródło każdego objaśnienia z atrybutem `lang`, axe
 * i brak poziomego przewijania przy 320 px. Bramki faktów dowodzi `job-explain.test.ts`.
 */
const locales = { pl, nl, fr, en } as const;
const DEMO_JOB = '/oferty-pracy/warehouse-worker-antwerp-1001';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const [locale, m] of Object.entries(locales) as [keyof typeof locales, typeof pl][]) {
  test(`wyjaśnienie oferty na żądanie, treść oferty bez zmian (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}${DEMO_JOB}`);
    await page.getByRole('button', { name: m.cookies.rejectOptional }).click();

    const panel = page.getByRole('region', { name: m.jobExplain.title });
    await expect(panel).toBeVisible();
    const description = await page.locator('#opis').innerText();
    await expect(panel.getByTestId('job-explain-result')).toHaveCount(0);

    // Klawiatura: fokus na przycisku i Enter.
    const button = panel.getByRole('button', { name: m.jobExplain.button });
    await button.focus();
    await page.keyboard.press('Enter');

    const result = panel.getByTestId('job-explain-result');
    await expect(result).toBeVisible();
    const heading = result.getByRole('heading', { level: 3 }).first();
    await expect(heading).toBeFocused();
    await expect(result.locator(`p[lang="${locale}"]`).first()).toBeVisible();
    await expect(result.locator('q').first()).toBeVisible();
    await expect(result.getByText(m.jobExplain.disclaimer)).toBeVisible();
    // Oferta nie została zastąpiona ani zmieniona.
    expect(await page.locator('#opis').innerText()).toBe(description);

    const axe = await new AxeBuilder({ page }).include('[data-testid="job-explain"]').withTags(TAGS).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
}

test('inny język wyjaśnienia niż strony; 320 px bez poziomego przewijania', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/pl${DEMO_JOB}`);
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  const panel = page.getByRole('region', { name: pl.jobExplain.title });
  await panel.getByRole('combobox', { name: pl.jobExplain.languageLabel }).selectOption('nl');
  await panel.getByRole('button', { name: pl.jobExplain.button }).click();
  const result = panel.getByTestId('job-explain-result');
  await expect(result).toBeVisible();
  await expect(result.locator('p[lang="nl"]').first()).toBeVisible();
  await expect(result.locator('p[lang="pl"]')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: pl.jobExplain.again })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).include('[data-testid="job-explain"]').withTags(TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
