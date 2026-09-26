import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Audyt P1-05/P1-06: szczegół kandydata w panelu pracodawcy (link z listy dopasowanych
 * kandydatów) i adresy list stronicowanych kursorem. Tryb demo (bez bazy) — `DEMO_CANDIDATES`.
 * Nieistniejący kandydat i oferta spoza firmy w filtrze zgłoszeń → 404 (bez ujawniania danych);
 * niepoprawny kursor w adresie = pierwsza strona, nie błąd.
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;

type Messages = { dashboard: Record<string, string> };

function load(locale: string): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8')) as Messages;
}

function withName(template: string, name: string): string {
  return template.replace('{name}', name);
}

for (const locale of locales) {
  test(`szczegół kandydata z listy: ${locale}`, async ({ page }) => {
    const m = load(locale);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/kandydaci`);

    const main = page.getByRole('main');
    await main.getByRole('link', { name: withName(m.dashboard.candidatesViewProfileLabel, 'Piotr Nowak') }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/employer/kandydaci/demo-c-1$`));

    await expect(main.getByRole('heading', { level: 1, name: 'Piotr Nowak' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: m.dashboard.employerApplicationProfile })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: m.dashboard.employerCandidateMatches })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: m.dashboard.employerCandidateApplications })).toBeVisible();
    await expect(main.getByText(m.dashboard.employerCandidateNoApplications)).toBeVisible();
    await expect(main.getByRole('link', { name: m.dashboard.employerCandidateBack })).toHaveAttribute(
      'href', `/${locale}/employer/kandydaci`);

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
  });
}

test('nieistniejący kandydat zwraca 404', async ({ page }) => {
  const response = await page.goto('/pl/employer/kandydaci/00000000-0000-0000-0000-000000000000');
  expect(response?.status()).toBe(404);
});

test('filtr zgłoszeń oferty spoza firmy zwraca 404', async ({ page }) => {
  const response = await page.goto('/pl/employer/aplikacje?oferta=00000000-0000-0000-0000-000000000000');
  expect(response?.status()).toBe(404);
});

test('niepoprawny kursor w adresie list = pierwsza strona', async ({ page }) => {
  const m = load('pl');
  for (const route of ['employer/aplikacje', 'employer/oferty', 'employer/kandydaci']) {
    const response = await page.goto(`/pl/${route}?po=zly!&przed=x`);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  }
  // Pierwsza strona demo: lista bez nawigacji „nowsze”.
  await page.goto('/pl/employer/aplikacje?po=zly');
  await expect(page.getByRole('link', { name: m.dashboard.employerApplicationsNewer })).toHaveCount(0);
});
