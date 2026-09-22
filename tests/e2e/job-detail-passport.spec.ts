import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];

type Messages = {
  jobs: {
    passport: {
      location: string;
      salary: string;
      conditions: string;
    };
    applyNow: string;
    saveUnavailable: string;
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

async function firstJobDetail(page: Page, locale: Locale): Promise<void> {
  await page.goto(`/${locale}/oferty-pracy`);
  const href = await page
    .locator('article a[href*="/oferty-pracy/"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);
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
  test(`paszport szczegółu zachowuje dane i akcje na 320 px: ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await firstJobDetail(page, locale);

    const t = messages(locale);
    const passport = page.getByTestId("job-detail-passport");
    await expect(passport).toBeVisible();
    await expect(passport.getByRole("heading", { level: 1 })).toBeVisible();

    const labels = passport.locator("dt");
    await expect(labels).toHaveText([
      t.jobs.passport.location,
      t.jobs.passport.salary,
      t.jobs.passport.conditions,
    ]);
    await expect(passport.locator("dd")).toHaveCount(3);

    // Zapis i aplikowanie pozostają prawdziwymi kontrolkami detalu, poza paszportem.
    await expect(
      page.getByRole("button", { name: t.jobs.saveUnavailable }).last(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: t.jobs.applyNow }).last(),
    ).toBeVisible();
    await expectNoDocumentOverflow(page);
  });
}

test("paszport szczegółu ma trzy czytelne kolumny na desktopie", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await firstJobDetail(page, "pl");

  const passport = page.getByTestId("job-detail-passport");
  const fields = passport.locator("dl > div");
  await expect(fields).toHaveCount(3);

  const boxes = await fields.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: Math.round(box.top), width: Math.round(box.width) };
    }),
  );
  expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
  for (const box of boxes) expect(box.width).toBeGreaterThan(150);
  await expectNoDocumentOverflow(page);
});
