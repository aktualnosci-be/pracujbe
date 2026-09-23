import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];
type Messages = { nav: { guides: string }; guides: { pageTitle: string } };

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

for (const locale of locales) {
  test(`stopka prowadzi do poradników: ${locale}`, async ({ page }) => {
    const t = messages(locale);
    await page.goto(`/${locale}/oferty-pracy`);

    const link = page
      .getByRole("contentinfo")
      .getByRole("link", { name: t.nav.guides, exact: true });
    await expect(link).toHaveAttribute("href", `/${locale}/poradniki`);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/poradniki$`));
    await expect(
      page.getByRole("heading", { level: 1, name: t.guides.pageTitle }),
    ).toBeVisible();
  });
}
