import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { messages } from './fixtures/messages';

/**
 * #188 (0091) — jednostka filtra wynagrodzeń. Dane demonstracyjne mają jedną ofertę
 * godzinową (id 1025, 14,50–16,75 EUR/godz.); pozostałe są miesięczne. Godzinowo
 * porównujemy tylko stawki godzinowe, kwoty miesięczne nie są przeliczane i nie odpadają.
 */

const HOURLY_JOB = /-1025$/;
const f = messages('en').filters;

async function acceptNecessaryCookies(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: {
          necessary: true,
          preferences: false,
          analytics: false,
        },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'jobs-list-salary-unit-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
}

async function resultsTotal(page: Page): Promise<number> {
  const text = await page.locator('[data-results-heading]:visible').first().innerText();
  const match = text.match(/\d+/);
  if (!match) throw new Error(`Brak liczby wyników: ${text}`);
  return Number(match[0]);
}

async function firstJobSlug(page: Page): Promise<string> {
  const href = await page
    .locator('main article a[href*="/oferty-pracy/"]')
    .first()
    .getAttribute('href');
  return (href ?? '').split('?')[0] ?? '';
}

test('stawka godzinowa: filtr i sortowanie porównują tylko stawki godzinowe', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();

  await page.goto('/en/oferty-pracy');
  const all = await resultsTotal(page);

  // Sort po stawce godzinowej: oferta godzinowa pierwsza, pozostałe (nieporównywalne) za nią.
  await page.goto('/en/oferty-pracy?salaryUnit=hour&sort=salary');
  expect(await firstJobSlug(page)).toMatch(HOURLY_JOB);
  expect(await resultsTotal(page)).toBe(all);
  const sortMenu = page.locator('details:visible').filter({
    has: page.locator('summary', { hasText: f.sortBy }),
  });
  await sortMenu.locator('summary').click();
  await expect(sortMenu.locator('a[aria-current="true"]')).toHaveText(f.sortSalaryHourly);

  // Od 17 EUR/godz.: odpada wyłącznie oferta 14,50–16,75/godz.
  await page.goto('/en/oferty-pracy?salaryUnit=hour&salaryMin=17&sort=salary');
  expect(await resultsTotal(page)).toBe(all - 1);
  expect(await firstJobSlug(page)).not.toMatch(HOURLY_JOB);
  // Chip widełek w jednostce godzinowej; usunięcie chipu wraca do jednostki miesięcznej.
  const chip = page.getByRole('link', { name: new RegExp(`${f.removeFilter}: .*/hour`) });
  await expect(chip).toBeVisible();
  expect(await chip.getAttribute('href')).not.toMatch(/salaryUnit|salaryMin/);

  // Kontrola ujemna: ten sam próg w jednostce miesięcznej (1500+) to inna reguła —
  // oferta godzinowa zostaje, bo nie przeliczamy stawek godzinowych na miesiąc.
  await page.goto('/en/oferty-pracy?salaryMin=1500&salaryMax=1500&sort=salary');
  await expect(page.locator(`main article a[href$="-1025"]`).first()).toBeAttached();
  await context.close();
});

test('przełącznik jednostki w panelu filtrów zmienia widełki i zapisuje jednostkę w URL', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await acceptNecessaryCookies(context, baseURL ?? 'http://localhost:3000');
  const page = await context.newPage();
  await page.goto('/en/oferty-pracy');

  const sidebar = page.locator('[data-filter-passport="desktop"]');
  const minSlider = sidebar.getByRole('slider', { name: f.salaryMin });
  await expect(minSlider).toHaveAttribute('max', '4500');
  await expect(sidebar.getByText(f.salaryPeriodNote)).toBeVisible();

  await sidebar.locator('label', { hasText: f.salaryUnitHour }).click();
  await expect(sidebar.getByRole('radio', { name: f.salaryUnitHour })).toBeChecked();
  await expect(sidebar.getByText(f.salaryHourly)).toBeVisible();
  await expect(sidebar.getByText(f.salaryHourlyNote)).toBeVisible();
  await expect(minSlider).toHaveAttribute('min', '10');
  await expect(minSlider).toHaveAttribute('max', '40');

  await minSlider.fill('17');
  await sidebar.getByRole('button', { name: /^Show \d+ jobs?$/ }).click();
  await expect(page).toHaveURL(/salaryUnit=hour/);
  await expect(page).toHaveURL(/salaryMin=17/);
  await context.close();
});
