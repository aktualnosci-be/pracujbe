import AxeBuilder from './fixtures/axe';
import { expect, test, type Page } from '@playwright/test';

import nlMessages from '../../src/messages/nl.json';

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
// #638: fikcyjna firma z 4 ofertami; fixture stronicuje po 2 (`FIXTURE_COMPANY_JOBS_PAGE_SIZE`),
// baza po 50 — ta sama logika (`getCompanyProfile`, `companyJobsLastPage`), inny rozmiar strony.
const PAGED = '/pracodawcy/portlog-gent';

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

test('profil: BreadcrumbList = widoczna ścieżka (Strona główna → Oferty pracy → firma)', async ({ page }) => {
  await page.goto(`/nl${PROFILE}`);
  const lists = (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((item) => item['@type'] === 'BreadcrumbList');
  expect(lists).toHaveLength(1);
  const items = lists[0]!.itemListElement as Array<{ name: string; item: string; position: number }>;
  const visible = (await page.getByRole('navigation', { name: nlMessages.common.breadcrumb }).getByRole('listitem').allTextContents())
    .map((text) => text.trim())
    .filter((text) => text !== '/');
  expect(items.map((entry) => entry.name)).toEqual(visible);
  expect(items.map((entry) => entry.position)).toEqual([1, 2, 3]);
  expect(items[0]!.item).toMatch(/\/nl$/);
  expect(items[1]!.item).toMatch(/\/nl\/oferty-pracy$/);
  expect(items[2]!.item).toMatch(new RegExp(`/nl${PROFILE}$`));
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

async function jobSlugs(page: Page): Promise<string[]> {
  return page
    .locator('.pp-job-grid a[href*="/oferty-pracy/"]')
    .evaluateAll((links) => [...new Set(links.map((link) => (link as HTMLAnchorElement).pathname))]);
}

test('profil z wieloma stronami: każda oferta osiągalna z profilu (#638)', async ({ page }) => {
  await page.goto(`/pl${PAGED}`);
  await expect(page.getByTestId('company-jobs-count')).toHaveText('4 aktywne oferty · Strona 1 z 2');
  const first = await jobSlugs(page);
  expect(first).toHaveLength(2);

  const nav = page.getByRole('navigation', { name: 'Paginacja' });
  await expect(nav.getByRole('link', { name: '1' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: '2' })).toHaveAttribute('href', `/pl${PAGED}/strona/2`);
  await nav.getByRole('link', { name: 'Następna' }).click();

  await expect(page).toHaveURL(new RegExp(`/pl${PAGED}/strona/2$`));
  await expect(page.getByTestId('company-jobs-count')).toHaveText('4 aktywne oferty · Strona 2 z 2');
  const second = await jobSlugs(page);
  expect(second).toHaveLength(2);
  expect(new Set([...first, ...second]).size).toBe(4);
  // Metadane z pełnego załadowania adresu (jak robot) — nawigacja kliencka w `next dev` chwilowo
  // trzyma w <head> także tagi poprzedniej strony.
  await page.goto(`/pl${PAGED}/strona/2`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/pl${PAGED}/strona/2$`));
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(page).toHaveTitle(/strona 2/);
  // Poprzednia strona = adres bazowy profilu (bez `/strona/1`).
  await expect(nav.getByRole('link', { name: 'Poprzednia' })).toHaveAttribute('href', `/pl${PAGED}`);
});

test('kontrola ujemna: strona za końcem, strona 1 i zapis niekanoniczny = 404 (#638)', async ({ page }) => {
  for (const suffix of ['/strona/3', '/strona/1', '/strona/02', '/strona/x']) {
    const response = await page.goto(`/pl${PAGED}${suffix}`);
    expect(response?.status(), suffix).toBe(404);
  }
  // Profil mieszczący się na jednej stronie nie ma nawigacji ani strony 2.
  await page.goto(`/pl${PROFILE}`);
  await expect(page.getByRole('navigation', { name: 'Paginacja' })).toHaveCount(0);
  expect((await page.goto(`/pl${PROFILE}/strona/2`))?.status()).toBe(404);
});

for (const locale of LOCALES) {
  for (const width of [320, 1280]) {
    test(`axe profilu firmy: ${locale}, ${width} px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const route of [PROFILE, WITHOUT_JOBS, `${PAGED}/strona/2`]) {
        // Baner pojawia się tylko bez zapisanej decyzji — każda trasa zaczyna od czystych cookies.
        await context.clearCookies();
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
