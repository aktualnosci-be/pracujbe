import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

type Locale = "pl" | "nl" | "fr" | "en";
type Messages = {
  errors: { notFound: string };
  common: { home: string; skipToContent: string };
  nav: { jobs: string };
  metadata: { homeTitle: string };
};

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

/**
 * 404 z różnych źródeł: szczegół oferty, poradnik, landing miasta oraz nieznana ścieżka
 * (catch-all `[locale]/[...rest]`, #257) — w czterech językach.
 */
const cases: ReadonlyArray<{ locale: Locale; path: string }> = [
  { locale: "pl", path: "/pl/to-nie-istnieje-123/glebiej" },
  { locale: "en", path: "/en/to-nie-istnieje-123" },
  { locale: "pl", path: "/pl/poradniki/nie-ma-takiego-poradnika" },
  { locale: "nl", path: "/nl/oferty-pracy/nie-ma-takiej-oferty" },
  { locale: "fr", path: "/fr/praca/miasto/nie-ma-takiego-miasta" },
  { locale: "en", path: "/en/oferty-pracy/nie-ma-takiej-oferty" },
];

for (const { locale, path } of cases) {
  test(`404 ma nawigację, właściwy tytuł i nazwane akcje: ${path}`, async ({ page }) => {
    const t = messages(locale);
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: t.errors.notFound }),
    ).toBeVisible();

    await expect(page).not.toHaveTitle(t.metadata.homeTitle);
    await expect(page).toHaveTitle(new RegExp(t.errors.notFound.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: t.common.home, exact: true })).toHaveAttribute(
      "href",
      `/${locale}`,
    );
    await expect(main.getByRole("link", { name: t.nav.jobs, exact: true })).toHaveAttribute(
      "href",
      `/${locale}/oferty-pracy`,
    );

    // Skip link prowadzi do głównej treści strony 404.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: t.common.skipToContent });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
  });
}
