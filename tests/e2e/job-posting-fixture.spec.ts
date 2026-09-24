import { expect, test, type Page } from '@playwright/test';

import plMessages from '../../src/messages/pl.json';

/**
 * JobPosting ofert „realnych” (#313, #301, P1-12). Uruchamiany na serwerze fixture
 * (`playwright.applications-fixture.config.ts`, tryb full): oferty fikcyjne nie są tam
 * oznaczane jako demo, więc strona zachowuje się jak przy ofertach z bazy. W zwykłym trybie
 * demo JobPosting jest pominięty (#297) — patrz tests/e2e/demo-jobs-labelled.spec.ts.
 * Test pełni też rolę kontroli ujemnej #297: bez flagi demo nie ma baneru ani noindex,
 * a zweryfikowana firma ma odznakę.
 */

async function jsonLdOfType(page: Page, type: string): Promise<Record<string, unknown>[]> {
  return (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((item) => item['@type'] === type);
}

const WAREHOUSE_JOB = '/pl/oferty-pracy/warehouse-worker-antwerp-1001';
const NL_ONLY_JOB = '/oferty-pracy/logistics-intern-ghent-1026';

test('oferta bez flagi demo: JobPosting z pełnym opisem, bez baneru demo i noindex', async ({ page }) => {
  await page.goto(WAREHOUSE_JOB);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  const [data] = await jsonLdOfType(page, 'JobPosting');
  expect(data).toBeTruthy();
  expect(typeof data!.title).toBe('string');
  expect(typeof data!.datePosted).toBe('string');
  expect(data!.hiringOrganization).toBeTruthy();
  expect(data!.jobLocation).toBeTruthy();
  const description = String(data!.description);
  expect(description).toMatch(/^<p>/);
  expect(description).toContain(`<h3>${plMessages.job.requirementsMandatory}</h3><ul><li>`);
  // Dane fikcyjne nie mają daty wygaśnięcia → pole pominięte, bez „datePosted + 60 dni”.
  expect(data).not.toHaveProperty('validThrough');
  // Okres wynagrodzenia z danych oferty (miesięczny).
  expect((data!.baseSalary as { value?: { unitText?: string } }).value?.unitText).toBe('MONTH');

  await expect(page.getByTestId('demo-jobs-notice')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(page.getByTestId('job-detail-passport').getByText(plMessages.job.verified)).toBeVisible();
});

test('oferta bez tłumaczenia: JobPosting tylko w wersji kanonicznej (#301)', async ({ page }) => {
  await page.goto(`/nl${NL_ONLY_JOB}`);
  expect(await jsonLdOfType(page, 'JobPosting')).toHaveLength(1);
  await page.goto(`/pl${NL_ONLY_JOB}`);
  expect(await jsonLdOfType(page, 'JobPosting')).toHaveLength(0);
});

test('lista bez flagi demo: bez baneru i etykiety „przykładowa”', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');
  await expect(page.locator('article').first()).toBeVisible();
  await expect(page.getByTestId('demo-jobs-notice')).toHaveCount(0);
  await expect(page.getByText(plMessages.jobs.demoBadge)).toHaveCount(0);
});
