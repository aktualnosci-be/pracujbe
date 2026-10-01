import { expect, test } from '@playwright/test';

import { AxeBuilder } from './fixtures/axe';
import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * #858 (migracja 0975 — numer tymczasowy): filtr „Grafik pracy” listy ofert — panel
 * z JavaScriptem i formularz bez JavaScriptu (parametr `shift`), chip na każdą wartość,
 * oferta bez deklaracji odpada, szczegół oferty pokazuje grafik. Dane demo (bez bazy).
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type ShiftMessages = { shiftPatterns: string; shiftPatternValues: Record<string, string>; removeFilter: string };

function shiftT(locale: string): ShiftMessages {
  return messages(locale as (typeof LOCALES)[number]).filters as unknown as ShiftMessages;
}

for (const locale of LOCALES) {
  test(`bez JavaScriptu: zaznaczone typy grafiku trafiają do adresu i chipów (${locale})`, async ({ browser }) => {
    const t = shiftT(locale);
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.goto(`/${locale}/oferty-pracy`);
    const form = page.locator('[data-filter-passport="no-js"]');
    await expect(form).toBeVisible();
    const group = form.getByRole('group', { name: t.shiftPatterns, exact: true });
    await group.getByRole('checkbox', { name: t.shiftPatternValues['weekend']!, exact: true }).check();
    await group.getByRole('checkbox', { name: t.shiftPatternValues['day']!, exact: true }).check();
    await form.locator('button[type="submit"]').click();
    await page.waitForLoadState('domcontentloaded');

    expect(new URL(page.url()).searchParams.get('shift')).toBe('day,weekend');
    const again = page.locator('[data-filter-passport="no-js"]').getByRole('group', { name: t.shiftPatterns, exact: true });
    await expect(again.getByRole('checkbox', { name: t.shiftPatternValues['weekend']!, exact: true })).toBeChecked();
    await expect(again.getByRole('checkbox', { name: t.shiftPatternValues['night']!, exact: true })).not.toBeChecked();

    // Chip usuwa tylko swoją wartość (link działa bez JS).
    const dayChip = page.getByRole('link', { name: `${t.removeFilter}: ${t.shiftPatternValues['day']}` });
    await expect(dayChip).toHaveCount(1);
    await dayChip.click();
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).searchParams.get('shift')).toBe('weekend');
    await context.close();
  });
}

test('filtr zawęża wyniki, a szczegół oferty pokazuje grafik', async ({ page }) => {
  const t = shiftT('pl');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/pl/oferty-pracy');
  await rejectOptionalCookies(page, 'pl');
  const all = await page.locator('main ul > li').count();
  await page.goto('/pl/oferty-pracy?shift=weekend');
  const cards = page.locator('main ul > li');
  const filtered = await cards.count();
  expect(filtered).toBeGreaterThan(0);
  // Kontrola ujemna: filtr nie przepuszcza ofert bez deklaracji weekendu.
  expect(filtered).toBeLessThan(all);
  const href = await cards.first().locator('a[href*="/oferty-pracy/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);
  await expect(page.getByTestId('job-shift-patterns')).toContainText(t.shiftPatternValues['weekend']!);
});

test('panel z JavaScriptem: zaznaczenie typu grafiku trafia do adresu', async ({ page }) => {
  const t = shiftT('en');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/oferty-pracy');
  await rejectOptionalCookies(page, 'en');
  const rail = page.locator('[data-filter-passport="desktop"]');
  await rail.getByRole('checkbox', { name: t.shiftPatternValues['night']!, exact: true }).click();
  await rail.locator('[data-filter-apply="desktop"]').click();
  await expect(page).toHaveURL(/(?:\?|&)shift=night(?:&|$)/);
});

for (const width of [320, 1280]) {
  test(`axe: lista z filtrem grafiku (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pl/oferty-pracy?shift=day,weekend');
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
