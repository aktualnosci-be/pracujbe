import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Hub `/praca` i landingi kategorii/miasta (issue #215):
 * - breadcrumb oznacza bieżącą stronę `aria-current="page"` (dokładnie jeden element),
 * - cele dotykowe przy 320 px: linki breadcrumbu, CTA „zobacz wszystkie…” i chipy
 *   „Inne branże/miasta” mają co najmniej 44 px wysokości.
 */

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];

type Messages = {
  common: { breadcrumb: string; home: string };
  landing: {
    breadcrumbHub: string;
    viewAllJobs: string;
    otherCategories: string;
    otherCities: string;
  };
  categories: Record<string, string>;
  locations: Record<string, string>;
};

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Messages;
}

const MIN_TARGET = 44;

for (const locale of locales) {
  const t = messages(locale);
  const pages = [
    { path: "/praca", current: t.landing.breadcrumbHub, trail: [t.common.home] },
    {
      path: "/praca/kategoria/construction",
      current: t.categories.construction,
      trail: [t.common.home, t.landing.breadcrumbHub],
    },
    {
      path: "/praca/miasto/brussels",
      current: t.locations.brussels,
      trail: [t.common.home, t.landing.breadcrumbHub],
    },
  ];

  for (const { path, current, trail } of pages) {
    test(`${locale}${path}: breadcrumb z aria-current i celami ≥ 44 px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`/${locale}${path}`);

      const nav = page.getByRole("navigation", { name: t.common.breadcrumb });
      const currentItem = nav.locator('[aria-current="page"]');
      await expect(currentItem).toHaveCount(1);
      await expect(currentItem).toHaveText(current);

      const links = nav.getByRole("link");
      await expect(links).toHaveText(trail);

      // CTA do pełnej listy (bez linków do pojedynczych ofert) i chipy sekcji „Inne branże/miasta”.
      const main = page.locator("main");
      const cta = main.locator('a[href$="/oferty-pracy"], a[href*="/oferty-pracy?"]');
      const otherHeading = path.includes("/kategoria/")
        ? t.landing.otherCategories
        : path.includes("/miasto/")
          ? t.landing.otherCities
          : null;
      const chips = otherHeading
        ? main.locator("section", { has: page.getByRole("heading", { name: otherHeading }) }).getByRole("link")
        : null;

      const targets = [
        ...(await links.all()),
        ...(await cta.all()),
        ...(chips ? await chips.all() : []),
      ];
      const measured: Array<{ text: string; height: number }> = [];
      for (const target of targets) {
        const box = await target.boundingBox();
        measured.push({
          text: ((await target.textContent()) ?? "").trim(),
          height: Math.round(box?.height ?? 0),
        });
      }

      // Breadcrumb + CTA (+ 9 chipów na landingach) — pusta lista oznaczałaby zepsuty selektor.
      expect(measured.length, JSON.stringify(measured)).toBeGreaterThanOrEqual(
        otherHeading ? trail.length + 1 + 9 : trail.length + 1,
      );
      const tooSmall = measured.filter((item) => item.height < MIN_TARGET);
      expect(tooSmall, `${locale}${path}\n${JSON.stringify(measured, null, 2)}`).toEqual([]);
    });
  }
}
