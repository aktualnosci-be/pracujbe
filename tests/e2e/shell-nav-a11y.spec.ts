import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];
type Messages = { nav: { menu: string; jobs: string; forEmployers: string } };

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

for (const locale of locales) {
  test.describe(`nawigacja główna: ${locale}`, () => {
    test("menu mobilne: dialog nazwany „Menu”, link logo bez słowa „Menu”, bieżąca sekcja oznaczona", async ({
      page,
    }) => {
      const t = messages(locale);
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(`/${locale}/oferty-pracy`);
      await page.getByRole("button", { name: t.nav.menu }).click();

      const dialog = page.getByRole("dialog", { name: t.nav.menu, exact: true });
      await expect(dialog).toBeVisible();

      const home = dialog.locator(`a[href="/${locale}"]`);
      await expect(home).toHaveAccessibleName(/\S/);
      await expect(home).not.toHaveAccessibleName(new RegExp(t.nav.menu));

      const nav = dialog.getByRole("navigation", { name: t.nav.menu });
      await expect(nav.getByRole("link", { name: t.nav.jobs })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.getByRole("link", { name: t.nav.forEmployers })).not.toHaveAttribute(
        "aria-current",
        /.+/,
      );
    });

    test("desktop: nawigacja w nagłówku ma etykietę i oznacza bieżącą stronę", async ({
      page,
    }) => {
      const t = messages(locale);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/${locale}/oferty-pracy`);

      const nav = page.getByRole("banner").getByRole("navigation", { name: t.nav.menu });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole("link", { name: t.nav.jobs })).toHaveAttribute(
        "aria-current",
        "page",
      );

      await page.goto(`/${locale}`);
      await expect(
        page
          .getByRole("banner")
          .getByRole("navigation", { name: t.nav.menu })
          .getByRole("link", { name: t.nav.jobs }),
      ).not.toHaveAttribute("aria-current", /.+/);
    });
  });
}
