import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * `/praca/miasto/<alias>` — nazwa miasta w dowolnym z 4 języków (lub inną wielkością liter)
 * prowadzi stałym przekierowaniem do kanonicznego klucza; goły `/praca/kategoria` i
 * `/praca/miasto` prowadzą do huba; nieznany slug nadal zwraca 404. Issue #219.
 */

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];

function locations(locale: Locale): Record<string, string> {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { locations: Record<string, string> }).locations;
}

/** Tak jak wpisałby to człowiek w pasku adresu: małe litery, bez akcentów, spacje → myślniki. */
function typed(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

const keys = Object.keys(locations("pl"));

for (const locale of locales) {
  test(`${locale}: przetłumaczone nazwy miast przekierowują na klucz`, async ({ request }) => {
    const checked: string[] = [];
    for (const source of locales) {
      const names = locations(source);
      for (const key of keys) {
        for (const alias of new Set([typed(names[key]), encodeURIComponent(names[key])])) {
          if (alias === key) continue;
          const response = await request.get(`/${locale}/praca/miasto/${alias}`, { maxRedirects: 0 });
          const where = `${locale}: ${alias} (${source}) → ${key}`;
          expect(response.status(), where).toBe(308);
          expect(new URL(response.headers()["location"] ?? "", "http://x").pathname, where).toBe(
            `/${locale}/praca/miasto/${key}`,
          );
          checked.push(alias);
        }
      }
    }
    // Pusta pętla (np. zmiana struktury JSON) nie może przejść po cichu.
    expect(checked.length).toBeGreaterThan(20);
  });
}

test("wielkość liter i kanoniczny adres", async ({ request, page }) => {
  const upper = await request.get("/pl/praca/miasto/Brussels", { maxRedirects: 0 });
  expect(upper.status()).toBe(308);
  expect(upper.headers()["location"]).toMatch(/\/pl\/praca\/miasto\/brussels$/);

  const canonical = await page.goto("/nl/praca/miasto/brussel");
  expect(canonical?.status()).toBe(200);
  await expect(page).toHaveURL(/\/nl\/praca\/miasto\/brussels$/);
  await expect(page.locator("h1")).toContainText(locations("nl").brussels);
});

test("goły segment kategorii/miasta prowadzi do huba, nieznany slug to 404", async ({ page, request }) => {
  for (const locale of locales) {
    for (const path of ["/praca/kategoria", "/praca/miasto", "/praca/kategoria/", "/praca/miasto/"]) {
      const response = await page.goto(`/${locale}${path}`);
      expect(response?.status(), `${locale}${path}`).toBe(200);
      await expect(page, `${locale}${path}`).toHaveURL(new RegExp(`/${locale}/praca$`));
    }
  }

  for (const path of ["/pl/praca/miasto/xyz", "/pl/praca/miasto/brusselsx", "/pl/praca/kategoria/xyz"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
});
