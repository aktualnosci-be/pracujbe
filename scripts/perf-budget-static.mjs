// Bramka wydajności — część statyczna (#395). Liczy JS (gzip) tras publicznych z wyniku
// `next build` (layouty od korzenia + strona, tak jak ładuje je przeglądarka) i rozmiar
// fontów w `.next/static/media`, porównuje z `perf-budgets.json`. Kod ≠ 0 = przekroczony
// budżet. Uruchamiany w jobie `build` po `check-next-build.mjs` (~1 s, bez drugiego builda).
// Tabela trafia do `$GITHUB_STEP_SUMMARY`, gdy zmienna jest ustawiona.
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { checkRouteBudgets, kb, markdownTable } from "./lib/perf-budget.mjs";

const budgets = JSON.parse(
  readFileSync(new URL("../perf-budgets.json", import.meta.url), "utf8"),
).static;
const pages = JSON.parse(
  readFileSync(".next/app-build-manifest.json", "utf8"),
).pages;

const routes = checkRouteBudgets(pages, budgets.routeJsGzipKb, (file) =>
  readFileSync(join(".next", file)),
);

const mediaDir = ".next/static/media";
const fonts = readdirSync(mediaDir)
  .filter((name) => name.endsWith(".woff2"))
  .map((name) => ({ name, bytes: statSync(join(mediaDir, name)).size }))
  .map((font) => ({ ...font, actualKb: kb(font.bytes) }));
const fontTotalKb = kb(fonts.reduce((sum, font) => sum + font.bytes, 0));
const rows = [
  ...routes.map((r) => ({ ...r, name: `JS ${r.name}` })),
  ...fonts.map((f) => ({
    name: `font ${f.name}`,
    actualKb: f.actualKb,
    budgetKb: budgets.fontFileMaxKb,
    ok: f.actualKb <= budgets.fontFileMaxKb,
  })),
  {
    name: "fonty razem",
    actualKb: fontTotalKb,
    budgetKb: budgets.fontTotalMaxKb,
    ok: fontTotalKb <= budgets.fontTotalMaxKb,
  },
];

const table = markdownTable(
  ["zasób", "KB (gzip JS / woff2)", "budżet KB", "wynik"],
  rows.map((r) => [
    `\`${r.name}\``,
    r.actualKb.toFixed(1),
    String(r.budgetKb),
    r.ok ? "✅" : "❌ ponad budżet",
  ]),
);
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Budżet wydajności (statyczny, #395)\n\n${table}\n\n`,
  );
}

const failed = rows.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(
    `\nPrzekroczony budżet wydajności (perf-budgets.json):\n${failed
      .map((r) => `  ${r.name}: ${r.actualKb.toFixed(1)} KB > ${r.budgetKb} KB`)
      .join(
        "\n",
      )}\nZmniejsz JS/font albo — świadomie, z uzasadnieniem w PR — podnieś budżet.`,
  );
  process.exit(1);
}
console.log("\nBudżety statyczne w normie.");
