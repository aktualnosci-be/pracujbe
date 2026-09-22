import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "@playwright/test";

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

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src", "messages", `${locale}.json`),
      "utf-8",
    ),
  ) as Messages;
}

for (const locale of locales) {
  test(`nagłówek listy ofert zachowuje wyszukiwanie GET i układ 320 px: ${locale}`, async ({
    page,
  }) => {
    const t = messages(locale);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/oferty-pracy?immediate=1`);

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
    await location.fill("Antwerpia");
    await submit.click();

    await expect(page).toHaveURL(new RegExp(`/${locale}/oferty-pracy\\?`));
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("heading", { level: 1, name: t.jobs.pageTitle }),
    ).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get("keyword")).toBe("magazyn");
    expect(url.searchParams.get("city")).toBe("Antwerpia");
    expect(url.searchParams.get("immediate")).toBe("1");

    const bounds = await search.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
  });
}
