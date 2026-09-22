import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { buildHubFacet } from "../../src/lib/jobs-hub";

const locales = ["pl", "nl", "fr", "en"] as const;
const viewportWidths = [320, 640] as const;

type Locale = (typeof locales)[number];

type Messages = {
  landing: {
    byCategoryTitle: string;
    byCityTitle: string;
  };
};

type OverflowReport = {
  documentWidth: number;
  viewportWidth: number;
  offenders: Array<{
    tag: string;
    href: string | null;
    left: number;
    right: number;
  }>;
};

function messages(locale: Locale): Messages {
  const path = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Messages;
}

async function setNecessaryConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "1.0",
        categories: {
          necessary: true,
          preferences: false,
          analytics: false,
          marketing: false,
        },
        ts: "2026-01-01T00:00:00.000Z",
        id: "jobs-hub-passport-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          (bounds.left < -1 || bounds.right > viewportWidth + 1)
        );
      })
      .slice(0, 10)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          href:
            element instanceof HTMLAnchorElement
              ? element.getAttribute("href")
              : null,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
        };
      });

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth,
      offenders,
    };
  });
}

async function expectNoOverflow(page: Page, context: string): Promise<void> {
  const report = await measureOverflow(page);
  const evidence = `${context}\n${JSON.stringify(report, null, 2)}`;
  expect(report.documentWidth, evidence).toBeLessThanOrEqual(
    report.viewportWidth + 1,
  );
  expect(report.offenders, evidence).toEqual([]);
}

function hubLists(page: Page, locale: Locale) {
  const t = messages(locale);
  return {
    categories: page.getByRole("list", { name: t.landing.byCategoryTitle }),
    cities: page.getByRole("list", { name: t.landing.byCityTitle }),
  };
}

for (const locale of locales) {
  test(`kafle /praca są używalne w ${locale} przy 320 i 640 px`, async ({
    page,
  }) => {
    await setNecessaryConsent(page.context());

    for (const width of viewportWidths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/praca`);

      const { categories, cities } = hubLists(page, locale);
      await expect(categories).toBeVisible();
      await expect(cities).toBeVisible();
      await expect(categories.getByRole("link")).toHaveCount(10);
      await expect(cities.getByRole("link")).toHaveCount(10);

      const firstCategory = categories.getByRole("link").first();
      const lastCategory = categories.getByRole("link").last();
      const firstCity = cities.getByRole("link").first();
      const lastCity = cities.getByRole("link").last();

      await expect(firstCategory).toHaveAttribute(
        "href",
        `/${locale}/praca/kategoria/construction`,
      );
      await expect(lastCategory).toHaveAttribute(
        "href",
        `/${locale}/praca/kategoria/seasonal`,
      );
      await expect(firstCity).toHaveAttribute(
        "href",
        `/${locale}/praca/miasto/brussels`,
      );
      await expect(lastCity).toHaveAttribute(
        "href",
        `/${locale}/praca/miasto/kortrijk`,
      );

      const box = await firstCategory.boundingBox();
      expect(
        box,
        `${locale}/${width}: brak geometrii pierwszego kafla`,
      ).not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

      await expectNoOverflow(page, `${locale}/praca przy ${width}px`);

      if (width === 640) {
        await page.keyboard.press("Tab");
        await firstCategory.focus();
        await expect(firstCategory).toBeFocused();
        const focusRing = await firstCategory.evaluate(
          (element) => getComputedStyle(element).boxShadow,
        );
        expect(focusRing).not.toBe("none");
      }
    }
  });

  test(`kafle /praca zachowują linki i liczniki bez JavaScriptu: ${locale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 900 },
    });
    await setNecessaryConsent(context);
    const page = await context.newPage();

    try {
      const response = await page.goto(`/${locale}/praca`);
      expect(response?.ok()).toBe(true);

      const { categories, cities } = hubLists(page, locale);
      await expect(categories.getByRole("link")).toHaveCount(10);
      await expect(cities.getByRole("link")).toHaveCount(10);
      await expect(categories.getByRole("link").first()).toHaveAttribute(
        "href",
        `/${locale}/praca/kategoria/construction`,
      );
      await expectNoOverflow(page, `${locale}/praca bez JavaScriptu`);

      await categories.getByRole("link").first().click();
      await expect(page).toHaveURL(`/${locale}/praca/kategoria/construction`);
      await expect(page.locator("h1")).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("kontrakt licznika przypisuje agregat do właściwego href", () => {
  const categoryCounts = { construction: 237, transport: 4 };
  const cityCounts = { Bruxelles: 91, Anvers: 12 };

  expect(
    buildHubFacet(
      "/praca/kategoria",
      "construction",
      "construction",
      categoryCounts,
    ),
  ).toEqual({ href: "/praca/kategoria/construction", count: 237 });
  expect(
    buildHubFacet("/praca/kategoria", "transport", "transport", categoryCounts),
  ).toEqual({
    href: "/praca/kategoria/transport",
    count: 4,
  });
  expect(
    buildHubFacet("/praca/miasto", "brussels", "Bruxelles", cityCounts),
  ).toEqual({
    href: "/praca/miasto/brussels",
    count: 91,
  });
  expect(
    buildHubFacet("/praca/miasto", "antwerp", "Anvers", cityCounts),
  ).toEqual({
    href: "/praca/miasto/antwerp",
    count: 12,
  });
  expect(buildHubFacet("/praca/miasto", "ghent", "Gand", cityCounts)).toEqual({
    href: "/praca/miasto/ghent",
    count: undefined,
  });
});

test("kontrola ujemna wykrywa kafel szerszy od viewportu", async ({ page }) => {
  await setNecessaryConsent(page.context());
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/pl/praca");
  await expectNoOverflow(page, "kontrola ujemna przed mutacją");

  const mutation = await page.addStyleTag({
    content:
      'a[href$="/praca/kategoria/construction"] { min-width: 400px !important; }',
  });
  const broken = await measureOverflow(page);
  expect(broken.documentWidth).toBeGreaterThan(broken.viewportWidth + 1);
  expect(
    broken.offenders.some(
      (offender) =>
        offender.tag === "a" &&
        offender.href?.endsWith("/praca/kategoria/construction"),
    ),
  ).toBe(true);

  await mutation.evaluate((style) => style.remove());
  await expectNoOverflow(page, "kontrola ujemna po przywróceniu");
});
