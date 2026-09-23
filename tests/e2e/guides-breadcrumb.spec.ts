import { expect, test } from "@playwright/test";

import { routing } from "../../src/i18n/routing";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import nl from "../../src/messages/nl.json";
import pl from "../../src/messages/pl.json";

/**
 * Breadcrumb poradników musi wskazywać technologiom asystującym bieżącą stronę
 * (`aria-current="page"`), a nie tylko kolorem. Bieżąca pozycja odpowiada H1 strony
 * i nie jest linkiem.
 */
const messages = { pl, nl, fr, en } as const;
const PATHS = [
  "/poradniki",
  "/poradniki/umowa-interim-co-warto-wiedziec",
] as const;

for (const locale of routing.locales) {
  test(`breadcrumb poradników (${locale}) oznacza bieżącą stronę`, async ({
    page,
  }) => {
    const m = messages[locale];

    for (const path of PATHS) {
      await page.goto(`/${locale}${path}`);

      const breadcrumb = page.getByRole("navigation", {
        name: m.common.breadcrumb,
      });
      const current = breadcrumb.locator('[aria-current="page"]');
      await expect(current, path).toHaveCount(1);

      const heading = (
        await page.getByRole("heading", { level: 1 }).innerText()
      ).trim();
      await expect(current, path).toHaveText(heading);
      await expect(current.locator("a"), path).toHaveCount(0);
    }
  });
}
