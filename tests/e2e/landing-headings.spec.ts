import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Landingi `/praca/kategoria/*` i `/praca/miasto/*`: hierarchia nagłówków w `main`
 * nie może przeskakiwać poziomów (H1 → H3). Lista ofert ma własny H2, pod którym
 * leżą tytuły ofert (H3 z JobCard). Issue #210.
 */

const locales = ["pl", "nl", "fr", "en"] as const;
const paths = ["/praca/kategoria/construction", "/praca/miasto/brussels"] as const;

type Locale = (typeof locales)[number];

function availableJobsLabel(locale: Locale): string {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  const messages = JSON.parse(readFileSync(file, "utf8")) as {
    landing: { availableJobs: string };
  };
  return messages.landing.availableJobs;
}

for (const locale of locales) {
  for (const path of paths) {
    test(`${locale}${path}: nagłówki nie przeskakują poziomów`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);

      const headings = await page
        .locator("main")
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            level: Number(node.tagName.slice(1)),
            text: (node.textContent ?? "").trim(),
          })),
        );

      expect(headings[0]?.level, JSON.stringify(headings)).toBe(1);
      for (let i = 1; i < headings.length; i += 1) {
        const jump = headings[i].level - headings[i - 1].level;
        expect(
          jump,
          `skok ${headings[i - 1].level}→${headings[i].level} przed „${headings[i].text}”\n${JSON.stringify(headings, null, 2)}`,
        ).toBeLessThanOrEqual(1);
      }

      // Lista ofert jest regionem nazwanym przez własny H2 (nie tylko aria-label).
      const label = availableJobsLabel(locale);
      const section = page.getByRole("region", { name: label });
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading", { level: 2, name: label })).toHaveCount(1);
      await expect(section.getByRole("heading", { level: 3 }).first()).toBeAttached();
    });
  }
}
