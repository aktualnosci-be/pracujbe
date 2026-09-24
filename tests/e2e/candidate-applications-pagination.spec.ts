import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

import { openZoomController, ZOOM_EXTENSION_ARGS } from './fixtures/zoom-controller';

import { rejectOptionalCookies } from './fixtures/messages';


const headings = {
  pl: 'Moje aplikacje',
  nl: 'Mijn sollicitaties',
  fr: 'Mes candidatures',
  en: 'My applications',
} as const;
const more = {
  pl: 'Pokaż więcej zgłoszeń',
  nl: 'Meer sollicitaties tonen',
  fr: 'Afficher plus de candidatures',
  en: 'Show more applications',
} as const;
const end = {
  pl: 'To wszystkie Twoje zgłoszenia.',
  nl: 'Dit zijn al je sollicitaties.',
  fr: 'Vous avez vu toutes vos candidatures.',
  en: 'These are all your applications.',
} as const;

for (const [locale, heading] of Object.entries(headings)) {
  test(`candidate application history fits 320px in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate/aplikacje`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    const cards = page.getByRole('main').getByRole('listitem');
    await expect(cards).toHaveCount(10);
    // Serwer dev kompiluje wyspy przy pierwszym wejściu; klik przed hydratacją ginie.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: more[locale as keyof typeof more] }).click();
    await expect(cards).toHaveCount(15);
    await expect(page.getByText(end[locale as keyof typeof end])).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test(`candidate application history fits browser zoom 200% in ${locale}`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'pracujbe-app-zoom-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 800 },
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
      await page.goto(new URL(`/${locale}/candidate/aplikacje`, baseURL).toString());
      await rejectOptionalCookies(page, locale);
      const tabId = await zoomController.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((entry) => entry.url?.startsWith(url));
        if (!tab?.id) throw new Error('Application tab missing');
        await chrome.tabs.setZoom(tab.id, 2);
        return tab.id;
      }, baseURL!);
      expect(await zoomController.evaluate((id) => chrome.tabs.getZoom(id), tabId)).toBe(2);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(640);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      const cards = page.getByRole('main').getByRole('listitem');
      await expect(cards).toHaveCount(10);
      // Serwer dev kompiluje wyspy przy pierwszym wejściu; klik przed hydratacją ginie.
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: more[locale as keyof typeof more] }).click();
      await expect(cards).toHaveCount(15);
      await expect(page.getByText(end[locale as keyof typeof end])).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
