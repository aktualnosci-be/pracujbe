import { expect, test } from "@playwright/test";

/**
 * Regresja #211: przy tekście powiększonym do 200% (WCAG 1.4.4) tytuły podobnych ofert
 * i nazwa firmy w karcie kontaktu zawijają się zamiast ucinać wielokropkiem.
 */

const DEMO_JOB_SLUG = "bricklayer-brussels-1002";

for (const [width, locale] of [
  [1280, "pl"],
  [640, "fr"],
] as const) {
  test(`tekst 200%: panel boczny nie ucina treści (${width} px, ${locale})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const similar = page.locator("#podobne li a");
    expect(await similar.count()).toBeGreaterThan(0);

    const clipped = await page.evaluate(() => {
      const aside = document.querySelector("main aside");
      if (!aside) return ["brak panelu bocznego"];
      return [...aside.querySelectorAll<HTMLElement>("p, h2, a")]
        .filter((el) => el.getClientRects().length > 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.tagName}: ${el.textContent?.trim()} (${el.scrollWidth}/${el.clientWidth})`);
    });
    expect(clipped, clipped.join("\n")).toEqual([]);
  });
}
