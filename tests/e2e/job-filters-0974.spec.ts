import { expect, test } from '@playwright/test';

import { AxeBuilder } from './fixtures/axe';
import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * Filtry listy ofert z migracji 0194 (numer tymczasowy): wymagany język i poziom (#786),
 * wymiar pracy (#811), promień od miejscowości (#824) — w panelu z JavaScriptem i w formularzu
 * bez JavaScriptu (te same parametry adresu), chipy z usuwaniem całego filtra i komunikat dla
 * nierozpoznanej miejscowości. Dane demo (bez bazy). Bramka axe 320/1280 px.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const locale of LOCALES) {
  test(`bez JavaScriptu: język, poziom, wymiar i promień przechodzą przez adres (${locale})`, async ({ browser }) => {
    const t = messages(locale).filters;
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.goto(`/${locale}/oferty-pracy`);
    const form = page.locator('[data-filter-passport="no-js"]');
    await expect(form).toBeVisible();

    await form.getByLabel(t.near, { exact: true }).fill('Gent');
    await form.getByRole('combobox', { name: t.radius, exact: true }).selectOption('50');
    await form.getByRole('combobox', { name: t.workTime, exact: true }).selectOption('full_time');
    await form.getByRole('combobox', { name: t.requiredLanguage, exact: true }).selectOption('nl');
    await form.getByRole('combobox', { name: t.languageLevel, exact: true }).selectOption('fluent');
    await form.locator('button[type="submit"]').click();
    await page.waitForLoadState('domcontentloaded');

    const params = new URL(page.url()).searchParams;
    expect(params.get('near')).toBe('Gent');
    expect(params.get('radius')).toBe('50');
    expect(params.get('workTime')).toBe('full_time');
    expect(params.get('lang')).toBe('nl');
    expect(params.get('langLevel')).toBe('fluent');

    // Formularz po przeładowaniu odtwarza wybór z adresu.
    const again = page.locator('[data-filter-passport="no-js"]');
    await expect(again.getByLabel(t.near, { exact: true })).toHaveValue('Gent');
    await expect(again.getByRole('combobox', { name: t.radius, exact: true })).toHaveValue('50');
    await expect(again.getByRole('combobox', { name: t.workTime, exact: true })).toHaveValue('full_time');
    await expect(again.getByRole('combobox', { name: t.requiredLanguage, exact: true })).toHaveValue('nl');
    await expect(again.getByRole('combobox', { name: t.languageLevel, exact: true })).toHaveValue('fluent');

    // Chip miejscowości usuwa miejscowość i promień naraz (link działa bez JS).
    const nearChip = page.getByRole('link', { name: new RegExp(`${t.removeFilter}: .*Gent`) });
    await expect(nearChip).toHaveCount(1);
    await nearChip.click();
    await page.waitForLoadState('domcontentloaded');
    const after = new URL(page.url()).searchParams;
    expect(after.get('near')).toBeNull();
    expect(after.get('radius')).toBeNull();
    expect(after.get('lang')).toBe('nl');
    await context.close();
  });
}

test('pusty formularz bez JavaScriptu nie włącza nowych filtrów (kontrola ujemna)', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
  const page = await context.newPage();
  await page.goto('/en/oferty-pracy');
  await page.locator('[data-filter-passport="no-js"] button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded');
  const t = messages('en').filters;
  await expect(page.getByRole('link', { name: new RegExp(`^${t.removeFilter}:`) })).toHaveCount(0);
  await context.close();
});

test('nierozpoznana miejscowość promienia: komunikat zamiast cichego pustego wyniku', async ({ page }) => {
  const t = messages('pl').filters;
  await page.goto('/pl/oferty-pracy?near=Nigdziebądź&radius=25');
  await expect(page.locator('[data-near-unknown]')).toHaveText(t.nearUnknown.replace('{place}', 'Nigdziebądź'));
  await page.goto('/pl/oferty-pracy?near=Gandawa&radius=25');
  await expect(page.locator('[data-near-unknown]')).toHaveCount(0);
});

for (const width of [320, 1280]) {
  test(`axe: lista z nowymi filtrami (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pl/oferty-pracy?lang=nl&langLevel=fluent&workTime=part_time&near=Gandawa&radius=50');
    await rejectOptionalCookies(page, 'pl');
    if (width < 1024) {
      await page.locator('[data-filter-passport="mobile-trigger"]').click();
      await expect(page.locator('[data-filter-passport="mobile-sheet"]')).toBeVisible();
    }
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('panel z JavaScriptem: wybór wymiaru pracy i języka trafia do adresu', async ({ page }) => {
  const t = messages('en').filters as unknown as Record<string, string>;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/oferty-pracy');
  await rejectOptionalCookies(page, 'en');
  const rail = page.locator('[data-filter-passport="desktop"]');
  await rail.getByRole('radio', { name: t['workTimePart'], exact: true }).check({ force: true });
  await rail.getByRole('combobox', { name: t['requiredLanguage'], exact: true }).click();
  await page.getByRole('option', { name: messages('en').languageNames!['nl']!, exact: true }).click();
  await rail.locator('[data-filter-apply="desktop"]').click();
  await expect(page).toHaveURL(/(?:\?|&)workTime=part_time(?:&|$)/);
  await expect(page).toHaveURL(/(?:\?|&)lang=nl(?:&|$)/);
});
