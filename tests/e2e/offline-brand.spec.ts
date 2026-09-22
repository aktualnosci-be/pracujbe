import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;

type Locale = (typeof locales)[number];

type Messages = {
  common: {
    appName: string;
    error: string;
    retry: string;
  };
};

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

async function expectNoHorizontalOverflow(
  page: Page,
  locale: Locale,
): Promise<void> {
  const report = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));

  expect(
    report.documentWidth,
    `${locale}/offline: ${JSON.stringify(report)}`,
  ).toBeLessThanOrEqual(report.viewportWidth + 1);
}

for (const locale of locales) {
  test(`ekran offline pokazuje dostępne logo i akcję przy 320 px: ${locale}`, async ({
    page,
  }) => {
    const t = messages(locale);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/offline`);

    await expect(
      page.getByRole("img", { name: t.common.appName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: t.common.error,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: t.common.retry, exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, locale);
  });
}

test("kontrola ujemna: zwykły tekst nazwy nie spełnia dostępnego kontraktu logo", async ({
  page,
}) => {
  const t = messages("pl");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/pl/offline");

  const logo = page.getByRole("img", { name: t.common.appName, exact: true });
  await expect(logo).toBeVisible();

  await logo.evaluate((element, appName) => {
    const plainText = document.createElement("p");
    plainText.textContent = appName;
    element.replaceWith(plainText);
  }, t.common.appName);

  await expect(page.getByText(t.common.appName, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: t.common.appName, exact: true }),
  ).toHaveCount(0);
});
