import { expect, test, type Page } from "@playwright/test";

import { routing } from "../../src/i18n/routing";

/**
 * Poradniki przy powiększeniu tekstu 200% (WCAG 1.4.4 / 1.4.10): długie słowa (np. NL
 * „Rijksregisternummer”) muszą się zawijać, a karty i treść artykułu nie mogą rozpychać
 * dokumentu w poziomie. 640 CSS px odpowiada 1280 px po powiększeniu przeglądarki do 200%;
 * dodatkowo podwajamy rozmiar tekstu (resize text), co najmocniej obciąża długie słowa.
 */
const PATHS = [
  "/poradniki",
  "/poradniki/numer-niss-i-podatki",
  "/poradniki/praca-w-belgii-bez-znajomosci-jezyka",
  "/poradniki/bezpieczenstwo-na-budowie-vca",
] as const;

async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const main = document.querySelector("main");
    const spilling = [
      ...(main?.querySelectorAll<HTMLElement>("article, h1, h2, p, li") ?? []),
    ]
      .filter(
        (el) =>
          el.scrollWidth > el.clientWidth + 1 &&
          !el.classList.contains("truncate"),
      )
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}: ${el.textContent?.trim().slice(0, 40)}`,
      );
    const beyondViewport = [...(main?.querySelectorAll<HTMLElement>("*") ?? [])]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => el.getBoundingClientRect().right > viewportWidth + 1)
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}: ${el.textContent?.trim().slice(0, 40)}`,
      );
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth,
      spilling,
      beyondViewport,
    };
  });
}

for (const locale of routing.locales) {
  test(`poradniki (${locale}) nie przewijają się w poziomie przy tekście 200%`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });

    for (const path of PATHS) {
      const response = await page.goto(`/${locale}${path}`);
      expect(response?.status(), path).toBe(200);
      // Strona musi faktycznie pokazać poradnik (lista kart lub artykuł), nie ekran błędu.
      await expect(
        page.getByRole("main").locator("article").first(),
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      const report = await overflowReport(page);
      const details = `${path}: ${JSON.stringify(report, null, 2)}`;
      expect(report.documentWidth, details).toBeLessThanOrEqual(
        report.viewportWidth + 1,
      );
      expect(report.spilling, details).toEqual([]);
      expect(report.beyondViewport, details).toEqual([]);
    }
  });
}
