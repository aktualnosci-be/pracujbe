import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;

type Locale = (typeof locales)[number];

type Messages = {
  filters: {
    title: string;
    close: string;
    immediate: string;
    showResults: string;
  };
  jobs: {
    pageTitle: string;
  };
};

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src", "messages", `${locale}.json`),
      "utf-8",
    ),
  ) as Messages;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function undersizedTargets(
  root: Locator,
): Promise<Array<{ target: string | null; height: number }>> {
  const targets = root.locator("[data-filter-target]");
  expect(await targets.count()).toBeGreaterThanOrEqual(8);

  return targets.evaluateAll((elements) =>
    elements
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          target: element.getAttribute("data-filter-target"),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      })
      .filter(({ height }) => height < 48),
  );
}

async function expectTargetsAtLeast48(root: Locator): Promise<void> {
  expect(await undersizedTargets(root)).toEqual([]);
}

function resultsPattern(template: string): RegExp {
  return new RegExp(`^${template.replace("{count}", "\\d+")}$`);
}

for (const locale of locales) {
  test(`filtry paszportowe zachowują SSR i hierarchię na desktopie i mobile: ${locale}`, async ({
    browser,
  }) => {
    const t = messages(locale);

    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const desktop = await desktopContext.newPage();
    await desktop.goto(`/${locale}/oferty-pracy`);

    const rail = desktop.locator('[data-filter-passport="desktop"]');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(rail).toHaveCSS("border-right-style", "solid");
    await expect(rail).toHaveCSS("border-left-width", "0px");
    await expect(rail.locator("section").nth(1)).toHaveCSS(
      "border-top-style",
      "solid",
    );
    await expectTargetsAtLeast48(rail);
    await expectNoHorizontalOverflow(desktop);

    const desktopImmediate = rail.getByRole("checkbox", {
      name: t.filters.immediate,
    });
    await desktopImmediate.focus();
    await expect(desktopImmediate).toBeFocused();
    await desktopImmediate.click();
    await rail
      .getByRole("button", { name: resultsPattern(t.filters.showResults) })
      .click();
    await expect(desktop).toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 320, height: 800 },
    });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`/${locale}/oferty-pracy`);
    const trigger = mobile.locator('[data-filter-passport="mobile-trigger"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveCSS("min-height", "48px");
    // Przy pierwszym, zimnym wejściu czekamy na podpięcie wyspy klienckiej Radix.
    await mobile.waitForTimeout(500);
    await trigger.click();

    const sheet = mobile.locator('[data-filter-passport="mobile-sheet"]');
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole("button", { name: t.filters.close });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(48);
    expect(closeBox?.height).toBeGreaterThanOrEqual(48);
    await expect(sheet.locator("section").nth(1)).toHaveCSS(
      "border-top-style",
      "solid",
    );
    await expectTargetsAtLeast48(sheet);
    await expectNoHorizontalOverflow(mobile);

    const mobileImmediate = sheet.getByRole("checkbox", {
      name: t.filters.immediate,
    });
    await mobileImmediate.click();
    await close.click();
    await expect(mobile).not.toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);

    // Kontrola ujemna: zamknięcie odrzuca stan oczekujący zamiast potajemnie zmieniać URL.
    await trigger.click();
    await expect(
      sheet.getByRole("checkbox", { name: t.filters.immediate }),
    ).not.toBeChecked();
    await sheet.getByRole("checkbox", { name: t.filters.immediate }).click();
    const mobileCta = sheet.getByRole("button", {
      name: resultsPattern(t.filters.showResults),
    });
    await expect(mobileCta).toHaveCSS("min-height", "48px");
    await mobileCta.click();
    await expect(mobile).toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);
    await expectNoHorizontalOverflow(mobile);
    await mobileContext.close();

    const noJsContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 800 },
    });
    const noJs = await noJsContext.newPage();
    const expectedNoJsParams = new URLSearchParams({
      keyword: "operator",
      city: "Brussels",
      sort: "salary",
      category: "construction,transport",
      location: "Brussels,Antwerp",
      contractType: "permanent,temporary",
      accommodation: "provided,unavailable",
      immediate: "1",
    });
    await noJs.goto(`/${locale}/oferty-pracy?${expectedNoJsParams.toString()}`);
    await expect(
      noJs.getByRole("heading", { level: 1, name: t.jobs.pageTitle }),
    ).toBeVisible();
    await expect(
      noJs.locator('[data-filter-passport="mobile-trigger"]'),
    ).toBeHidden();
    const noJsForm = noJs.locator('[data-filter-passport="no-js"]');
    await expect(noJsForm).toBeVisible();
    await expect(
      noJsForm.getByRole("checkbox", { name: t.filters.immediate }),
    ).toBeChecked();
    await noJsForm.getByRole("checkbox", { name: /.+/ }).last().check();
    await noJsForm.locator('button[type="submit"]').click();
    await expect(noJs).toHaveURL(/(?:\?|&)noLang=1(?:&|$)/);
    await noJs.waitForLoadState("domcontentloaded");
    await expect(noJs.locator("html")).toBeAttached();
    const submittedParams = new URL(noJs.url()).searchParams;
    for (const [key, value] of expectedNoJsParams) {
      expect(submittedParams.get(key), key).toBe(value);
    }
    expect(submittedParams.get("noLang")).toBe("1");
    await expectNoHorizontalOverflow(noJs);
    await noJsContext.close();
  });
}

test("kontrola ujemna wykrywa zbyt mały cel filtra", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/pl/oferty-pracy");
  const rail = page.locator('[data-filter-passport="desktop"]');
  await expectTargetsAtLeast48(rail);

  const mutation = await page.addStyleTag({
    content:
      '[data-filter-target="checkbox-label"]{height:24px!important;min-height:0!important}',
  });
  await expect
    .poll(async () =>
      (await undersizedTargets(rail)).some(
        ({ target, height }) => target === "checkbox-label" && height < 48,
      ),
    )
    .toBe(true);

  await mutation.evaluate((style) => style.remove());
  await expectTargetsAtLeast48(rail);
});
