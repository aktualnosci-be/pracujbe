import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 1.4.4 / 1.4.10: karta oferty (JobCard) przy 640 px i tekście 200% nie może
 * przepełniać się poziomo (na granicy `sm` siatka paszportu ma 3 wąskie kolumny,
 * a etykiety pól to długie słowa wersalikami, np. „VOORWAARDEN”).
 */

const locales = ["pl", "nl", "fr", "en"] as const;

async function cardOverflow(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main article")].flatMap((card, index) => {
      const bounds = card.getBoundingClientRect();
      const inner = [...card.querySelectorAll<HTMLElement>("*")].filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          element.scrollWidth > element.clientWidth + 1 ||
          box.right > bounds.right + 1 ||
          box.left < bounds.left - 1
        );
      });
      return card.scrollWidth > card.clientWidth + 1 || inner.length > 0
        ? [
            {
              index,
              scrollWidth: card.scrollWidth,
              clientWidth: card.clientWidth,
              offenders: inner.slice(0, 3).map((element) => element.textContent?.slice(0, 40)),
            },
          ]
        : [];
    }),
  );
}

for (const locale of locales) {
  test(`${locale}: karta oferty mieści się przy 640 px i tekście 200%`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`/${locale}/oferty-pracy`);
    const cards = page.locator("main article");
    await expect(cards.first()).toBeVisible();

    // Przy 100% etykiety pól paszportu mieszczą się w jednej linii (wygląd bez zmian).
    const labelLines = await cards
      .first()
      .locator("dt")
      .evaluateAll((labels) =>
        labels.map((label) => {
          const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
          return Math.round(label.getBoundingClientRect().height / lineHeight);
        }),
      );
    expect(labelLines.length).toBeGreaterThan(0);
    expect(labelLines.every((lines) => lines === 1), JSON.stringify(labelLines)).toBe(true);

    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect.poll(() => cardOverflow(page).then((list) => JSON.stringify(list))).toBe("[]");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}
