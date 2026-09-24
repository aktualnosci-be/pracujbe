import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 1.4.10 (reflow): przy 320 px i tekście powiększonym do 200% nagłówek (hamburger,
 * logo z kafelkiem „.be”, ikona konta) nie może rozpychać dokumentu w poziomie.
 * Treść stron ma własne testy przepełnienia, więc tu mierzymy wkład SAMEGO nagłówka:
 * po ukryciu <main> i stopki dokument nie może być szerszy niż ekran.
 */
const locales = ["pl", "nl", "fr", "en"] as const;

async function enlargeText(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
}

for (const locale of locales) {
  test(`nagłówek bez poziomego scrolla: ${locale} @ 320px, tekst 200%`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/oferty-pracy`);
    await enlargeText(page);

    const report = await page.evaluate(() => {
      const root = document.documentElement;
      const header = document.querySelector("body header");
      const controls = Array.from(header?.querySelectorAll<HTMLElement>("a, button, [role=img]") ?? [])
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { label: el.getAttribute("aria-label") ?? el.textContent?.trim(), left: r.left, right: r.right };
        });
      for (const el of document.querySelectorAll<HTMLElement>("main, footer")) el.style.display = "none";
      return {
        clientWidth: root.clientWidth,
        headerScrollWidth: header?.scrollWidth ?? Number.POSITIVE_INFINITY,
        documentScrollWidth: root.scrollWidth,
        outside: controls.filter((c) => c.left < -1 || c.right > root.clientWidth + 1),
      };
    });

    expect(report.outside, JSON.stringify(report)).toEqual([]);
    expect(report.headerScrollWidth, JSON.stringify(report)).toBeLessThanOrEqual(report.clientWidth + 1);
    expect(report.documentScrollWidth, JSON.stringify(report)).toBeLessThanOrEqual(report.clientWidth + 1);
  });

  test(`nagłówek przy 100% bez zmian wyglądu: ${locale} @ 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/oferty-pracy`);

    const logo = await page.evaluate(() => {
      const header = document.querySelector("body header");
      const box = (el: Element | null | undefined) => {
        const r = el?.getBoundingClientRect();
        return r ? { width: r.width, height: r.height } : null;
      };
      const mark = Array.from(header?.querySelectorAll("[role=img]") ?? []).find(
        (el) => el.getClientRects().length > 0,
      );
      const tile = mark?.querySelector(":scope > span > span");
      const tileStyle = tile ? getComputedStyle(tile) : null;
      return {
        fontSize: mark ? getComputedStyle(mark).fontSize : null,
        logo: box(mark),
        tile: box(tile),
        tilePadding: tileStyle?.padding,
        tileRadius: tileStyle?.borderRadius,
        iconButtons: Array.from(header?.querySelectorAll("a[aria-label], button[aria-label]") ?? [])
          .filter((el) => el.getClientRects().length > 0)
          .map(box),
      };
    });

    // Wygląd = kalka `.people .nav` z prototypu „Ludzie i praca” przy ≤ 600 px (#5/#7),
    // niezależnie od renderowania fontu na danej maszynie: logo 26 px, kafelek „.be”
    // z dopełnieniem .1/.17/.14 em i promieniem .22 em (`.people .logo .suffix`), leading-none,
    // więc wysokość = 26 × (1 + .1 + .14) ≈ 32,2 px; przycisk menu 38 × 38 px (= „pigułka” konta).
    expect(logo.fontSize).toBe("26px");
    expect(logo.tilePadding).toBe("2.6px 4.42px 3.64px");
    expect(logo.tileRadius).toBe("5.72px");
    expect(logo.logo?.height).toBeCloseTo(32.24, 0);
    expect(logo.tile?.height).toBeCloseTo(32.24, 0);
    expect(logo.iconButtons).toEqual([{ width: 38, height: 38 }]);
  });
}
