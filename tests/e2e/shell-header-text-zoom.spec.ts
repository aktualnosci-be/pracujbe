import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 1.4.4: przy tekście powiększonym do 200% nagłówek na szerokościach tabletu/małego
 * laptopa nie może wypychać akcji poza ekran ani powodować poziomego przewijania dokumentu.
 */
const locales = ["pl", "nl", "fr", "en"] as const;
const widths = [768, 1024] as const;

async function enlargeText(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
}

for (const locale of locales) {
  for (const width of widths) {
    test(`nagłówek przy tekście 200%: ${locale} @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/oferty-pracy`);
      await enlargeText(page);

      const report = await page.evaluate(() => {
        const header = document.querySelector("header");
        const controls = Array.from(
          header?.querySelectorAll<HTMLElement>("a, button") ?? [],
        ).filter((el) => el.getClientRects().length > 0);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          outside: controls
            .map((el) => ({ text: el.textContent?.trim(), right: el.getBoundingClientRect().right }))
            .filter((c) => c.right > document.documentElement.clientWidth + 1),
        };
      });

      expect(report.outside, JSON.stringify(report)).toEqual([]);
      expect(report.scrollWidth, JSON.stringify(report)).toBeLessThanOrEqual(
        report.clientWidth + 1,
      );
    });
  }
}
