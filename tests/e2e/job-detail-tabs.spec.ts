import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "@playwright/test";

/**
 * Regresja #207: nawigacja po sekcjach szczegółu oferty.
 * - każda kotwica ma istniejący cel (także na ofercie bez podobnych ofert),
 * - nawigacja ma własną nazwę, różną od etykiet pozycji,
 * - brak stałego `aria-current` (strona nie śledzi bieżącej sekcji).
 */

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];
type Job = { tabDescription: string; tabCompany: string; tabSimilar: string; sectionsNav: string };

function job(locale: Locale): Job {
  return (JSON.parse(
    readFileSync(resolve(process.cwd(), "src", "messages", `${locale}.json`), "utf-8"),
  ) as { job: Job }).job;
}

// W danych demo: pierwsza oferta ma podobne, druga (jedyna w kategorii) — nie.
const SLUGS = ["bricklayer-brussels-1002", "office-cleaner-brussels-1004"];

for (const locale of locales) {
  for (const slug of SLUGS) {
    test(`kotwice sekcji prowadzą do istniejących celów: ${locale} ${slug}`, async ({ page }) => {
      await page.goto(`/${locale}/oferty-pracy/${slug}`);
      const t = job(locale);
      const nav = page.getByRole("navigation", { name: t.sectionsNav, exact: true });
      await expect(nav).toBeVisible();
      expect([t.tabDescription, t.tabCompany, t.tabSimilar]).not.toContain(t.sectionsNav);

      const links = nav.locator('a[href^="#"]');
      expect(await links.count()).toBeGreaterThan(0);
      const missing = await links.evaluateAll((anchors) =>
        anchors
          .map((a) => a.getAttribute("href")!.slice(1))
          .filter((id) => !document.getElementById(id)),
      );
      expect(missing).toEqual([]);
      await expect(nav.locator("[aria-current]")).toHaveCount(0);
    });
  }
}
