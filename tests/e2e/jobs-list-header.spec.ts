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
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/oferty-pracy\\?`)),
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
