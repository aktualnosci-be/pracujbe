import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type Locator, type Page } from "@playwright/test";

import { openZoomController, ZOOM_EXTENSION_ARGS } from "./fixtures/zoom-controller";

const locales = ["pl", "nl", "fr", "en"] as const;

async function expectNoHorizontalOverflow(page: Page, route: string) {
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.content, `${route}: ${JSON.stringify(widths)}`).toBeLessThanOrEqual(
    widths.viewport + 1,
  );
}

async function expectControlInsideViewport(page: Page, control: Locator, route: string) {
  const box = await control.boundingBox();
  expect(box, `${route}: główna akcja jest widoczna`).not.toBeNull();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box!.x, `${route}: lewa krawędź akcji`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${route}: prawa krawędź akcji`).toBeLessThanOrEqual(width + 1);
}

for (const locale of locales) {
  test(`rzeczywisty zoom 200%: panele i kreator zachowują reflow (${locale})`, async () => {
    const profile = await mkdtemp(join(tmpdir(), "pracujbe-panel-zoom-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: ZOOM_EXTENSION_ARGS,
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const zoomController = await openZoomController(context, page);
      const baseURL = test.info().project.use.baseURL;
      expect(baseURL).toBeTruthy();
      await page.goto(new URL(`/${locale}/candidate`, baseURL).toString());

      const tabId = await zoomController.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((item) =>
          item.url?.startsWith(url),
        );
        if (!tab?.id) throw new Error("Nie znaleziono karty panelu");
        await chrome.tabs.setZoom(tab.id, 2);
        return tab.id;
      }, baseURL!);

      const routes = [
        `/${locale}/candidate`,
        `/${locale}/candidate/profil`,
        `/${locale}/employer`,
        `/${locale}/employer/oferty/nowa`,
      ];
      let lastControl: Locator | undefined;
      for (const route of routes) {
        await page.goto(new URL(route, baseURL).toString());
        const zoom = await zoomController.evaluate((id) => chrome.tabs.getZoom(id), tabId);
        expect(zoom, `${route}: powiększenie przeglądarki`).toBe(2);
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(640);
        expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page, route);

        if (route.endsWith("/candidate/profil")) {
          lastControl = page.locator(`a[href="/${locale}/candidate/onboarding"]`).first();
        } else if (route.endsWith("/employer")) {
          lastControl = page.locator(`a[href="/${locale}/employer/oferty/nowa"]`).first();
        } else if (route.endsWith("/oferty/nowa")) {
          await expect(page.getByRole("navigation").filter({ has: page.locator('[aria-current="step"]') })).toBeVisible();
          lastControl = page.getByRole("textbox").first();
        } else {
          lastControl = page.getByRole("main").getByRole("link").first();
        }
        await expect(lastControl).toBeVisible();
        await expectControlInsideViewport(page, lastControl, route);
      }

      // Kontrola ujemna: zbyt szerokie pole musi zostać wykryte nawet przy overflow:hidden.
      await lastControl!.evaluate((element) => { (element as HTMLElement).style.width = "800px"; });
      await expect(expectControlInsideViewport(page, lastControl!, "kontrola ujemna")).rejects.toThrow();
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
