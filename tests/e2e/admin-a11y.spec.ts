import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { rejectOptionalCookies } from './fixtures/messages';

/**
 * Panel administratora w trybie DEMO (bez Supabase): bramka axe-core WCAG 2.x A/AA
 * (critical/serious) na wszystkich trasach `/admin/*` (#316), dialog potwierdzenia zmiany
 * statusu firmy (#310) oraz kafelek kolejki weryfikacji prowadzący do listy (#307).
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .withTags(WCAG_TAGS)
    .analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? '') || v.id === 'target-size')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}


const ROUTES = [
  '/admin',
  '/admin/firmy',
  // Szczegół firmy (#310) — firma demonstracyjna.
  '/admin/firmy/demo-c2',
  '/admin/zgloszenia',
  '/admin/uzytkownicy',
  // Blokady adresów e-mail (#44).
  '/admin/poczta',
  // Przegląd pytań screeningowych (#497).
  '/admin/pytania',
  '/admin/dziennik',
  '/admin/odwolania',
  '/admin/raport-dsa',
];

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 320, height: 800 },
]) {
  for (const locale of ['pl', 'nl', 'fr', 'en']) {
    test(`admin a11y: trasy /admin/* (${locale}, ${viewport.width} px) — brak naruszeń`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      for (const route of ROUTES) {
        await page.goto(`/${locale}${route}`);
        await page.getByRole('main').first().waitFor();
        await page.waitForTimeout(500);
        expect(await blockingViolations(page), `${locale}${route}`).toEqual([]);
      }
    });
  }
}

test('admin: zawieszenie firmy wymaga potwierdzenia w dialogu z danymi firmy', async ({ page }) => {
  await page.goto('/pl/admin/firmy?status=verified');
  await rejectOptionalCookies(page, 'pl');
  const row = page.getByRole('row', { name: /AGO Jobs & HR/ });
  await row.getByRole('button', { name: 'Zawieś' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('BE0123456789');
  // Zawieszenie wymaga uzasadnienia (#310) — fokus startuje na polu.
  await expect(dialog.getByRole('textbox', { name: 'Uzasadnienie (wymagane)' })).toBeFocused();
  expect(await blockingViolations(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Zawieś' })).toBeFocused();
});

test('admin: kafelek „Oczekujące na weryfikację” prowadzi do kolejki unverified + pending', async ({
  page,
}) => {
  await page.goto('/pl/admin');
  await page.getByRole('link', { name: /Oczekujące na weryfikację/ }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/firmy\?status=awaiting$/);
  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /Horeca Brussel Group/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Bouwbedrijf De Vos/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /AGO Jobs & HR/ })).toHaveCount(0);
});
