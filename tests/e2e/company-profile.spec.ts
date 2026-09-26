import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Profil publiczny firmy pod SEO i kandydata (#591). Serwer fixture
 * (`playwright.applications-fixture.config.ts`, tryb full): oferty fikcyjne zachowują się jak
 * oferty z bazy, a profil i slug ma wyłącznie firma zweryfikowana (`src/lib/company-fixture.ts`).
 * Sprawdza: link do profilu z karty oferty i z nagłówka szczegółu, Organization JSON-LD,
 * `noindex` profilu bez aktywnych ofert, 404 firmy niezweryfikowanej oraz bramkę axe
 * (critical/serious, z `target-size`) przy 320 i 1280 px w 4 językach.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);
const SLUG = 'antwerp-logistics-nv';
const PROFILE = `/pracodawcy/${SLUG}`;
const WITHOUT_JOBS = '/pracodawcy/fikcyjna-firma-bez-ofert';
const JOB = '/oferty-pracy/warehouse-worker-antwerp-1001';

async function blockingViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `[${v.impact}] ${v.id} (${v.nodes.length}×): ${v.nodes[0]?.target.join(' ')}`);
}

async function organizations(page: Page): Promise<Record<string, unknown>[]> {
  return (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((item) => item['@type'] === 'Organization');
}

test('karta oferty na liście linkuje do profilu zweryfikowanej firmy', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');
  const link = page.getByRole('main').getByRole('link', { name: 'Antwerp Logistics NV', exact: true }).first();
  await expect(link).toHaveAttribute('href', `/pl${PROFILE}`);
  // Kontrola ujemna: firma niezweryfikowana nie dostaje linku do profilu.
  await expect(page.getByRole('main').getByRole('link', { name: 'CleanPro Services', exact: true })).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/pl${PROFILE}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Antwerp Logistics NV' })).toBeVisible();
});

test('nagłówek szczegółu oferty linkuje do profilu firmy', async ({ page }) => {
  await page.goto(`/pl${JOB}`);
  await expect(page.getByRole('main').getByRole('link', { name: 'Antwerp Logistics NV', exact: true }).first())
    .toHaveAttribute('href', `/pl${PROFILE}`);
});

test('profil z ofertami: Organization JSON-LD, indeksowalny', async ({ page }) => {
  await page.goto(`/nl${PROFILE}`);
  const [org] = await organizations(page);
  expect(org).toMatchObject({ name: 'Antwerp Logistics NV', url: expect.stringMatching(new RegExp(`/nl${PROFILE}$`)) });
  expect((org!.address as Record<string, unknown>).addressCountry).toBe('BE');
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/nl${PROFILE}$`));
});

test('profil bez aktywnych ofert: noindex, follow i brak canonical', async ({ page }) => {
  await page.goto(`/fr${WITHOUT_JOBS}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /nofollow/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('firma niezweryfikowana nie ma profilu (404)', async ({ page }) => {
  const response = await page.goto('/pl/pracodawcy/cleanpro-services');
  expect(response?.status()).toBe(404);
});

for (const locale of LOCALES) {
  for (const width of [320, 1280]) {
    test(`axe profilu firmy: ${locale}, ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const route of [PROFILE, WITHOUT_JOBS]) {
        await page.goto(`/${locale}${route}`);
        await page.getByRole('main').first().waitFor();
        await rejectOptionalCookies(page, locale);
        expect.soft(await blockingViolations(page), `/${locale}${route}`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect.soft(overflow, `/${locale}${route}: brak poziomego przewijania`).toBeLessThanOrEqual(1);
      }
    });
  }
}
