import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];

function messages(locale: Locale): { errors: { notFound: string } } {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8"));
}

for (const locale of locales) {
  test(`nieznana ścieżka daje zlokalizowane 404: ${locale}`, async ({ page }) => {
    const response = await page.goto(`/${locale}/to-nie-istnieje-123/glebiej`);

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { level: 1, name: messages(locale).errors.notFound }),
    ).toBeVisible();
    await expect(page.getByRole("main").locator(`a[href="/${locale}"]`)).toBeVisible();
  });
}

test("adres bez prefiksu języka trafia do zlokalizowanego 404, a nie do domyślnej strony Next", async ({
  page,
}) => {
  const response = await page.goto("/xx/abc");

  expect(response?.status()).toBe(404);
  // next-intl dobiera język z Accept-Language i przekierowuje pod prefiks.
  const locale = new URL(page.url()).pathname.split("/")[1] as Locale;
  expect(locales).toContain(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(
    page.getByRole("heading", { level: 1, name: messages(locale).errors.notFound }),
  ).toBeVisible();
});

test("404 poza segmentem językowym jest wielojęzyczne i prowadzi do 4 wersji", async ({
  page,
}) => {
  const response = await page.goto("/brak-takiego-pliku.png");

  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", /^(pl|nl|fr|en)$/);
  await expect(page).not.toHaveTitle(/This page could not be found/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const locale of locales) {
    await expect(page.getByRole("main").locator(`a[href="/${locale}"]`)).toBeVisible();
  }
});
