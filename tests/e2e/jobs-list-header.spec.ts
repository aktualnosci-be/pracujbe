import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;

type Locale = (typeof locales)[number];

type Messages = {
  jobs: {
    pageTitle: string;
    keyword: string;
    location: string;
    searchJobs: string;
  };
};

const activeFilters = {
  category: "warehouse",
  location: "Antwerpia",
  contractType: "temporary",
  salaryMin: "1800",
  salaryMax: "3200",
  accommodation: "provided",
  immediate: "1",
  noLang: "1",
  date: "30d",
  sort: "salary",
} as const;

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src", "messages", `${locale}.json`),
      "utf-8",
    ),
  ) as Messages;
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right >
          document.documentElement.clientWidth + 1,
      )
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className),
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));

  expect(
    dimensions.document,
    JSON.stringify(dimensions.offenders, null, 2),
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

for (const locale of locales) {
  test(`wyszukiwarka GET bez JavaScriptu zachowuje filtry i reflow: ${locale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 900 },
    });
    const page = await context.newPage();
    const t = messages(locale);
    const initial = new URLSearchParams({ ...activeFilters, page: "4" });

    await page.goto(`/${locale}/oferty-pracy?${initial.toString()}`);

    await expect(
      page.getByRole("heading", { level: 1, name: t.jobs.pageTitle }),
    ).toBeVisible();

    const search = page.getByRole("search");
    const keyword = search.getByLabel(t.jobs.keyword, { exact: true });
    const location = search.getByLabel(t.jobs.location, { exact: true });
    const submit = search.getByRole("button", {
      name: t.jobs.searchJobs,
      exact: true,
    });

    await expect(keyword).toBeVisible();
    await expect(location).toBeVisible();
    await expect(submit).toBeVisible();
    expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      48,
    );

    await keyword.fill("magazyn");
    await location.fill("Bruksela");
    // Adres początkowy też ma query string, więc sam wzorzec ścieżki spełnia się od
    // razu i test czytałby DOM w trakcie podmiany dokumentu (documentElement === null).
    // Czekamy na adres z wysłanymi wartościami i pełne załadowanie nowej strony.
    await Promise.all([
      page.waitForURL(
        (target) =>
          target.pathname === `/${locale}/oferty-pracy` &&
          target.searchParams.get("keyword") === "magazyn",
        { waitUntil: "load" },
      ),
      submit.click(),
    ]);

    const url = new URL(page.url());
    expect(url.searchParams.get("keyword")).toBe("magazyn");
    expect(url.searchParams.get("city")).toBe("Bruksela");
    for (const [key, value] of Object.entries(activeFilters)) {
      expect(url.searchParams.get(key), key).toBe(value);
    }
    expect(url.searchParams.has("page")).toBe(false);

    await expectNoDocumentOverflow(page);
    // 640 CSS px odpowiada obszarowi 1280 px przy powiększeniu przeglądarki do 200%.
    await page.setViewportSize({ width: 640, height: 900 });
    await expectNoDocumentOverflow(page);

    await context.close();
  });
}

/**
 * #7 — nagłówek listy = kalka `.p-list-header` + `.people .search` prototypu „Ludzie i praca”:
 * nadtytuł w kolorze marki, H1 40 px (≤ 600 px: 32 px), jeden kontener wyszukiwarki z promieniem
 * 17 px, pola bez własnych ramek (fokus = obrys komórki), czerwony przycisk 58 px (≤ 850 px:
 * pełna szerokość w kolumnie, ≤ 600 px: 48 px — cel dotyku nadal ≥ 48 px).
 */
for (const { width, h1, button, columns } of [
  { width: 1280, h1: 40, button: 58, columns: 3 },
  { width: 390, h1: 32, button: 48, columns: 1 },
]) {
  test(`nagłówek i wyszukiwarka listy w stylu prototypu (${width} px)`, async ({ page }) => {
    const t = messages("pl");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/pl/oferty-pracy");

    const heading = page.getByRole("heading", { level: 1, name: t.jobs.pageTitle });
    const header = page.locator("header", { has: heading });
    const eyebrow = header.locator(".pp-eyebrow");
    await expect(eyebrow).toBeVisible();
    await expect(eyebrow).toHaveCSS("color", "rgb(217, 41, 50)");
    await expect(eyebrow).toHaveCSS("text-transform", "uppercase");
    await expect(heading).toHaveCSS("font-size", `${h1}px`);
    await expect(heading).toHaveCSS("font-weight", "700");

    const search = page.getByRole("search");
    await expect(search).toHaveCSS("border-top-left-radius", "17px");
    const keyword = search.getByLabel(t.jobs.keyword, { exact: true });
    await expect(keyword).toHaveCSS("border-top-width", "0px");
    const columnCount = await search.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(columnCount).toBe(columns);

    const submit = search.getByRole("button", { name: t.jobs.searchJobs, exact: true });
    await expect(submit).toHaveCSS("background-color", "rgb(217, 41, 50)");
    expect(Math.round((await submit.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(button);

    // Fokus klawiatury: widoczny obrys komórki pola (pole nie ma własnej ramki).
    await keyword.focus();
    const cellShadow = await keyword.evaluate(
      (el) => getComputedStyle(el.closest("label") as Element).boxShadow,
    );
    expect(cellShadow).not.toBe("none");
    await expectNoDocumentOverflow(page);
  });
}
