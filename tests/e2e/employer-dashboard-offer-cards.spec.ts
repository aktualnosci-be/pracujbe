import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, expect, test, type Locator, type Page } from '@playwright/test';

import { openZoomController, ZOOM_EXTENSION_ARGS } from './fixtures/zoom-controller';

const locales = ['pl', 'nl', 'fr', 'en'] as const;

function copy(locale: (typeof locales)[number]) {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as {
    dashboard: {
      yourActiveOffers: string;
      seeAllOffers: string;
      employerOffersApplicationsLabel: string;
      colMatched: string;
      navOffers: string;
    };
    status: { active: string };
  };
}

/** Wartość pola karty (`dd`) wskazanego etykietą `dt` — niezależnie od kolejności pól (#376). */
function field(card: Locator, label: string): Locator {
  return card
    .locator('dl > div')
    .filter({ has: card.page().locator('dt', { hasText: label }) })
    .locator('dd');
}

type OfferCard = { title: string; city: string; applications: string; matched: string };

async function readCard(card: Locator, t: ReturnType<typeof copy>['dashboard']): Promise<OfferCard> {
  const title = card.getByRole('heading');
  await expect(field(card, t.employerOffersApplicationsLabel)).toHaveCount(1);
  await expect(field(card, t.colMatched)).toHaveCount(1);
  return {
    title: (await title.innerText()).trim(),
    city: (await card.locator('p').filter({ has: card.page().locator('svg') }).innerText()).trim(),
    applications: (await field(card, t.employerOffersApplicationsLabel).innerText()).trim(),
    matched: (await field(card, t.colMatched).innerText()).trim(),
  };
}

/**
 * Liczby i miasto oferty z pełnej listy `/employer/oferty` — to samo źródło danych
 * (`getCompanyJobsLoad`) co podgląd na pulpicie. Test nie zna liczb z danych demo (#376).
 */
async function offersFromList(page: Page, locale: (typeof locales)[number]): Promise<OfferCard[]> {
  const { dashboard: t } = copy(locale);
  await page.goto(`/${locale}/employer/oferty`);
  const cards = page.getByRole('list', { name: t.navOffers, exact: true }).getByRole('article');
  await expect(cards).not.toHaveCount(0);
  const result: OfferCard[] = [];
  for (const card of await cards.all()) result.push(await readCard(card, t));
  return result;
}

async function expectOfferCards(page: Page, locale: (typeof locales)[number], expected?: OfferCard[]) {
  const { dashboard: t, status } = copy(locale);
  const list = page.getByRole('list', { name: t.yourActiveOffers });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(list.locator('article')).toHaveCount(5);
  await expect(list.locator('table')).toHaveCount(0);
  const first = list.locator('article').first();
  await expect(first.getByRole('heading', { level: 3 })).toBeVisible();
  await expect(first.getByText(status.active, { exact: true })).toBeVisible();
  await expect(first.locator('dt').filter({ hasText: t.employerOffersApplicationsLabel })).toBeVisible();
  await expect(first.locator('dt').filter({ hasText: t.colMatched })).toBeVisible();
  const card = await readCard(first, t);
  expect(card.applications).toMatch(/^\d+$/);
  expect(card.matched).toMatch(/^\d+$/);
  if (expected) {
    const same = expected.find((offer) => offer.title === card.title);
    expect(same, `oferta „${card.title}” z pulpitu jest na liście ofert`).toBeDefined();
    expect(card).toEqual(same);
  }
  await expect(page.getByRole('link', { name: t.seeAllOffers })).toHaveAttribute('href', `/${locale}/employer/oferty`);
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const bounds = await list.locator('article').evaluateAll((cards) => cards.map((card) => {
    const rect = card.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  expect(bounds.length).toBe(5);
  for (const rect of bounds) {
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.right).toBeLessThanOrEqual(viewportWidth + 1);
  }
}

for (const locale of locales) {
  test(`${locale}: karty ofert pracodawcy mieszczą się przy 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const expected = await offersFromList(page, locale);
    await page.goto(`/${locale}/employer`);
    await expectOfferCards(page, locale, expected);

    // Kontrola ujemna: asercja geometrii wykrywa wyjście karty poza viewport,
    // nawet gdy kontener strony ukryje poziomy pasek przewijania.
    const list = page.getByRole('list', { name: copy(locale).dashboard.yourActiveOffers });
    const first = list.locator('article').first();
    await first.evaluate((card) => { card.style.minWidth = '800px'; });
    const right = await first.evaluate((card) => card.getBoundingClientRect().right);
    expect(right).toBeGreaterThan(await page.evaluate(() => document.documentElement.clientWidth + 1));
  });

  test(`${locale}: karty ofert mieszczą się przy rzeczywistym zoomie 200%`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'pracujbe-employer-cards-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: ZOOM_EXTENSION_ARGS,
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const zoomController = await openZoomController(context, page);
      const baseURL = test.info().project.use.baseURL;
      expect(baseURL).toBeTruthy();
      await page.goto(new URL(`/${locale}/employer`, baseURL).toString());
      const zoom = await zoomController.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((item) => item.url?.startsWith(url));
        if (!tab?.id) throw new Error('Nie znaleziono karty panelu pracodawcy');
        await chrome.tabs.setZoom(tab.id, 2);
        return chrome.tabs.getZoom(tab.id);
      }, baseURL!);
      expect(zoom).toBe(2);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(640);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
      await expectOfferCards(page, locale);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
