// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  checkRouteBudgets,
  clsFromShifts,
  median,
  routeEntries,
  routeJsFiles,
  tbtFromLongtasks,
} from "../../scripts/lib/perf-budget.mjs";

// Bramka wydajności (#395): logika liczenia budżetów bez builda i bez przeglądarki.

const pages: Record<string, string[]> = {
  "/layout": [
    "static/chunks/webpack.js",
    "static/chunks/react.js",
    "static/css/root.css",
  ],
  "/[locale]/layout": ["static/chunks/webpack.js", "static/chunks/intl.js"],
  "/[locale]/(public)/layout": [
    "static/chunks/webpack.js",
    "static/chunks/header.js",
  ],
  "/[locale]/(public)/page": [
    "static/chunks/webpack.js",
    "static/chunks/home.js",
  ],
};

describe("JS trasy z app-build-manifest", () => {
  it("składa layouty od korzenia i stronę", () => {
    expect(routeEntries("/[locale]/(public)/oferty-pracy/[slug]/page")).toEqual(
      [
        "/layout",
        "/[locale]/layout",
        "/[locale]/(public)/layout",
        "/[locale]/(public)/oferty-pracy/layout",
        "/[locale]/(public)/oferty-pracy/[slug]/layout",
        "/[locale]/(public)/oferty-pracy/[slug]/page",
      ],
    );
  });

  it("liczy każdy plik JS raz, bez CSS", () => {
    expect(routeJsFiles(pages, "/[locale]/(public)/page")).toEqual([
      "static/chunks/webpack.js",
      "static/chunks/react.js",
      "static/chunks/intl.js",
      "static/chunks/header.js",
      "static/chunks/home.js",
    ]);
  });

  it("brak wpisu strony = błąd, nie cichy zerowy rozmiar", () => {
    expect(() => routeJsFiles(pages, "/[locale]/(public)/brak/page")).toThrow(
      /Brak wpisu/,
    );
  });

  it("50 KB kodu w layoucie publicznym przekracza budżet (kontrola ujemna)", () => {
    const files: Record<string, Buffer> = {};
    const read = (file: string) => files[file] ?? Buffer.from(`/* ${file} */`);
    const budgets = { "/[locale]/(public)/page": 5 };
    expect(checkRouteBudgets(pages, budgets, read)[0]?.ok).toBe(true);

    // Niekompresowalna treść: gzip jej nie zmniejszy, jak realnego kodu po minifikacji.
    let seed = 1;
    const noise = Buffer.alloc(50 * 1024, 0).map(
      () => (seed = (seed * 16807) % 2147483647) % 256,
    );
    files["static/chunks/header.js"] = Buffer.from(noise);
    const [row] = checkRouteBudgets(pages, budgets, read);
    expect(row?.ok).toBe(false);
    expect(row?.actualKb).toBeGreaterThan(50);
  });
});

describe("metryki lab", () => {
  it("mediana nieparzystej i parzystej liczby prób, NaN pomijane", () => {
    expect(median([900, 700, 2000])).toBe(900);
    expect(median([1, 3, 2, 4])).toBe(2.5);
    expect(median([Number.NaN, 5])).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("CLS = największe okno sesji", () => {
    const shifts = [
      { t: 100, v: 0.02 },
      { t: 600, v: 0.02 },
      // przerwa > 1 s — nowe okno
      { t: 3000, v: 0.01 },
    ];
    expect(clsFromShifts(shifts)).toBeCloseTo(0.04);
    expect(clsFromShifts([])).toBe(0);
  });

  it("TBT liczy tylko część long taska po FCP ponad 50 ms", () => {
    const tasks = [
      { t: 0, d: 200 }, // przed FCP=100: blokuje 100 ms po FCP → 50
      { t: 300, d: 120 }, // 70
      { t: 500, d: 40 }, // krótki — 0
    ];
    expect(tbtFromLongtasks(tasks, 100)).toBe(120);
  });
});

describe("perf-budgets.json", () => {
  const budgets = JSON.parse(readFileSync("perf-budgets.json", "utf8"));

  it("obejmuje kluczowe strony publiczne i ma progi lab", () => {
    expect(Object.keys(budgets.static.routeJsGzipKb)).toEqual(
      expect.arrayContaining([
        "/[locale]/(public)/page",
        "/[locale]/(public)/oferty-pracy/page",
        "/[locale]/(public)/oferty-pracy/[slug]/page",
        "/[locale]/(public)/poradniki/[slug]/page",
        "/[locale]/(auth)/logowanie/page",
      ]),
    );
    expect(budgets.lab.runs).toBeGreaterThanOrEqual(3);
    expect(budgets.lab.runs % 2).toBe(1);
    for (const key of ["lcpMsFirstVisit", "lcpMsWithConsent", "cls", "tbtMs"]) {
      expect(budgets.lab.thresholds[key]).toBeGreaterThan(0);
    }
  });
});
