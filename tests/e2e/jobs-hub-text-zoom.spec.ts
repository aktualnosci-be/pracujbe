import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Hub `/praca` przy powiększeniu SAMEGO tekstu do 200% (WCAG 1.4.4). Issue #213.
 *
 * Warunki odtworzenia: viewport 640 / 1024 / 1280 CSS px + `html { font-size: 200% }`.
 * Każdy fragment tekstu kafla (tytuł, opis, licznik) musi mieścić się w prostokącie
 * swojego linku, a przy 640 px dokument nie może przewijać się w poziomie.
 * (Przy 768+ px nagłówek serwisu ma osobne przepełnienie — poza zakresem tego testu,
 * dlatego szerokość dokumentu sprawdzamy tylko przy 640 px.)
 */

const locales = ["pl", "nl", "fr", "en"] as const;
const widths = [640, 1024, 1280] as const;

type Locale = (typeof locales)[number];

function listLabels(locale: Locale): string[] {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  const messages = JSON.parse(readFileSync(file, "utf8")) as {
    landing: { byCategoryTitle: string; byCityTitle: string };
  };
  return [messages.landing.byCategoryTitle, messages.landing.byCityTitle];
}

type TileOverflow = { tile: string; text: string; right: number; tileRight: number };

async function tileTextOverflow(page: Page, labels: string[]): Promise<TileOverflow[]> {
  return page.evaluate((names) => {
    const problems: TileOverflow[] = [];
    for (const name of names) {
      const list = document.querySelector<HTMLElement>(`ul[aria-label="${CSS.escape(name)}"]`);
      if (!list) throw new Error(`brak listy ${name}`);
      for (const link of list.querySelectorAll<HTMLAnchorElement>("a")) {
        const box = link.getBoundingClientRect();
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.right > box.right + 1 || rect.left < box.left - 1) {
              problems.push({
                tile: link.getAttribute("href") ?? "",
                text: node.textContent.trim().slice(0, 40),
                right: Math.round(rect.right),
                tileRight: Math.round(box.right),
              });
              break;
            }
          }
        }
      }
    }
    return problems;
  }, labels);
}

async function enlargeText(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  // Dwie klatki: układ po zmianie rozmiaru czcionki jest już przeliczony.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

for (const locale of locales) {
  test(`${locale}/praca: tekst kafli mieści się przy tekście 200%`, async ({ page }) => {
    const labels = listLabels(locale);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/praca`);
      await enlargeText(page);

      const problems = await tileTextOverflow(page, labels);
      expect(problems, `${locale} ${width}px\n${JSON.stringify(problems, null, 2)}`).toEqual([]);

      if (width === 640) {
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `${locale} ${width}px: poziomy scroll`).toBeLessThanOrEqual(
          clientWidth + 1,
        );
      }
    }
  });
}

test("przy standardowym rozmiarze tekstu układ ma nadal 2 kolumny przy 640 px i 3 przy 1280 px", async ({
  page,
}) => {
  const [categories] = listLabels("pl");
  const list = page.getByRole("list", { name: categories });
  for (const [width, columns] of [
    [640, 2],
    [1280, 3],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/pl/praca");
    const tops = await list
      .getByRole("link")
      .evaluateAll((links) => links.slice(0, 4).map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(tops.filter((top) => top === tops[0]).length, `${width}px: ${tops}`).toBe(columns);
  }
});
