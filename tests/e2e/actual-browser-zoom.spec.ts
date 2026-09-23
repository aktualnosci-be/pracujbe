import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
const extensionPath = resolve(__dirname, "fixtures/browser-zoom");

for (const locale of locales) {
  test(`rzeczywisty zoom 200%: wyszukiwanie ofert działa bez poziomego przewijania (${locale})`, async () => {
    const t = JSON.parse(
      readFileSync(resolve("src/messages", `${locale}.json`), "utf8"),
    ) as {
      cookies: { rejectOptional: string };
      home: { heroTitle: string; searchButton: string };
      jobs: {
        pageTitle: string;
        keyword: string;
        location: string;
        searchJobs: string;
      };
      filters: { title: string; immediate: string };
    };
    const profile = await mkdtemp(join(tmpdir(), "pracujbe-zoom-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    });

    try {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));
      const page = context.pages()[0] ?? (await context.newPage());
      const baseURL = test.info().project.use.baseURL;
      expect(baseURL).toBeTruthy();
      await page.goto(new URL(`/${locale}`, baseURL).toString());

      const zoom = await worker.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((item) =>
          item.url?.startsWith(url),
        );
        if (!tab?.id) throw new Error("Nie znaleziono karty testowanej strony");
        await chrome.tabs.setZoom(tab.id, 2);
        return chrome.tabs.getZoom(tab.id);
      }, baseURL!);
      expect(zoom).toBe(2);
      await expect
        .poll(() => page.evaluate(() => window.innerWidth))
        .toBe(640);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);

      await page
        .getByRole("button", { name: t.cookies.rejectOptional })
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: t.home.heroTitle }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page
        .getByRole("search")
        .getByRole("button", { name: t.home.searchButton })
        .click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/oferty-pracy(?:\\?|$)`));
      await expect(
        page.getByRole("heading", { level: 1, name: t.jobs.pageTitle }),
      ).toBeVisible();
      // Browser zoom belongs to the tab. Confirm it survived client navigation.
      const zoomAfterNavigation = await worker.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((item) =>
          item.url?.startsWith(url),
        );
        if (!tab?.id) throw new Error("Nie znaleziono karty ofert");
        return chrome.tabs.getZoom(tab.id);
      }, baseURL!);
      expect(zoomAfterNavigation).toBe(2);
      expect(await page.evaluate(() => window.innerWidth)).toBe(640);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
      await expect(page.locator('a[href*="/oferty-pracy/"]').first()).toBeVisible();
      const search = page.getByRole("search");
      await expect(search.getByLabel(t.jobs.keyword, { exact: true })).toBeVisible();
      await expect(search.getByLabel(t.jobs.location, { exact: true })).toBeVisible();
      await expect(
        search.getByRole("button", { name: t.jobs.searchJobs, exact: true }),
      ).toBeVisible();
      const filterTrigger = page.getByRole("button", {
        name: t.filters.title,
        exact: true,
      });
      await expect(filterTrigger).toBeVisible();
      await filterTrigger.click();
      const dialog = page.getByRole("dialog", { name: t.filters.title });
      await expect(dialog).toBeVisible();
      const immediate = dialog.getByRole("checkbox", {
        name: t.filters.immediate,
      });
      await immediate.click();
      await expect(immediate).toBeChecked();
      await expectNoHorizontalOverflow(page);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.content, JSON.stringify(widths)).toBeLessThanOrEqual(
    widths.viewport + 1,
  );
}
