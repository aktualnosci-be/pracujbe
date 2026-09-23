import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * #300: pracodawca otwiera zgłoszenie z listy i z pulpitu; widzi wiadomość, telefon,
 * dostępność, profil i historię. Nieistniejące / cudze zgłoszenie → 404 (bez ujawniania danych).
 * Tryb demo (bez Supabase) — dane `DEMO_APPLICATIONS` / `DEMO_APPLICATION_DETAILS`.
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;

type Messages = {
  dashboard: Record<string, string>;
  onboarding: Record<string, string>;
  status: Record<string, string>;
};

function load(locale: string): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8')) as Messages;
}

for (const locale of locales) {
  test(`szczegół zgłoszenia z listy: ${locale}`, async ({ page }) => {
    const m = load(locale);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/aplikacje`);

    const main = page.getByRole('main');
    await main.getByRole('link', { name: new RegExp(`^${m.dashboard.employerApplicationView}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/employer/aplikacje/demo-app-1$`));

    await expect(main.getByRole('heading', { level: 1, name: 'Piotr Nowak' })).toBeVisible();
    await expect(main.getByText('Mam 6 lat doświadczenia', { exact: false })).toBeVisible();
    await expect(main.getByRole('link', { name: '+32 470 12 34 56' })).toHaveAttribute('href', 'tel:+32470123456');
    await expect(main.getByText(m.onboarding.availImmediate, { exact: true })).toBeVisible();
    await expect(main.getByText('VCA Basis')).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: m.dashboard.employerApplicationHistory })).toBeVisible();
    await expect(main.getByRole('button', { name: new RegExp(`^${m.dashboard.employerApplicationMessage}`) })).toBeEnabled();

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');

    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
  });
}

test('szczegół zgłoszenia bez wiadomości i profilu pokazuje jawne braki', async ({ page }) => {
  const m = load('pl');
  await page.goto('/pl/employer/aplikacje/demo-app-4');
  const main = page.getByRole('main');
  await expect(main.getByText(m.dashboard.employerApplicationNoMessage)).toBeVisible();
  await expect(main.getByText(m.dashboard.employerApplicationNoProfile)).toBeVisible();
  await expect(main.getByText(m.dashboard.employerApplicationNotProvided).first()).toBeVisible();
});

test('pulpit pracodawcy linkuje do szczegółu zgłoszenia', async ({ page }) => {
  const m = load('pl');
  await page.goto('/pl/employer');
  const link = page.getByRole('main').getByRole('link', { name: new RegExp(`^${m.dashboard.employerApplicationView}`) }).first();
  await expect(link).toHaveAttribute('href', /\/pl\/employer\/aplikacje\/demo-app-\d$/);
});

test('nieistniejące zgłoszenie zwraca 404', async ({ page }) => {
  const response = await page.goto('/pl/employer/aplikacje/00000000-0000-0000-0000-000000000000');
  expect(response?.status()).toBe(404);
});
