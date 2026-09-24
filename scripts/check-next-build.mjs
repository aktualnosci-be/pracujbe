// Sprawdza, czy odtworzony katalog .next jest kompletnym buildem produkcyjnym (#127).
// Kod wyjścia ≠ 0 → CI buduje aplikację od nowa zamiast uruchamiać E2E na niepełnym buildzie.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const required = [
  "BUILD_ID",
  "build-manifest.json",
  "app-build-manifest.json",
  "app-path-routes-manifest.json",
  "prerender-manifest.json",
  "routes-manifest.json",
  "required-server-files.json",
  "server/app",
  "server/middleware-manifest.json",
  "static",
];

const missing = required.filter((path) => !existsSync(`.next/${path}`));
if (missing.length > 0) {
  console.error(`Niekompletny build .next, brakuje: ${missing.join(", ")}`);
  process.exit(1);
}

const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
if (!existsSync(`.next/static/${buildId}`)) {
  console.error(`Brak zasobów statycznych dla BUILD_ID ${buildId}`);
  process.exit(1);
}
if (readdirSync(".next/server/app").length === 0) {
  console.error("Pusty katalog .next/server/app");
  process.exit(1);
}

// #298: strony publiczne bez danych per użytkownik muszą być w prerenderze. Jeden dynamiczny
// odczyt (np. next-intl bez jawnego locale w layoucie) przełącza całe drzewo `(public)` na SSR
// z `Cache-Control: no-store`. Build bez bazy (CI/E2E) prerenderuje także strony z ofertami.
const prerendered = JSON.parse(readFileSync(".next/prerender-manifest.json", "utf8")).routes;
const expectedStatic = [
  "/pl",
  "/pl/poradniki",
  "/pl/poradniki/umowa-interim-co-warto-wiedziec",
  "/pl/praca",
  "/pl/praca/kategoria/construction",
  "/pl/praca/miasto/brussels",
  "/pl/dla-pracodawcow",
  "/pl/regulamin",
  "/en/faq",
];
const buildHasDatabase = Boolean(process.env.DATABASE_APP_URL);
const notPrerendered = buildHasDatabase ? [] : expectedStatic.filter((route) => !prerendered[route]);
if (notPrerendered.length > 0) {
  console.error(`Strony publiczne poza prerenderem (renderowane dynamicznie): ${notPrerendered.join(", ")}`);
  process.exit(1);
}
// #390: Zod (~15 KB gz) nie trafia do JS stron publicznych bez formularzy. Graf importów pilnuje
// tego już w teście jednostkowym `public-bundle-no-zod`; tu sprawdzamy realne chunki builda.
const appPages = JSON.parse(readFileSync(".next/app-build-manifest.json", "utf8")).pages;
const zodFreeEntries = [
  "/[locale]/(public)/layout",
  "/[locale]/(public)/page",
  "/[locale]/(public)/oferty-pracy/page",
  "/[locale]/(public)/poradniki/[slug]/page",
];
const zodChunks = [];
for (const entry of zodFreeEntries) {
  const files = appPages[entry];
  if (!files) {
    console.error(`Brak wpisu ${entry} w app-build-manifest.json`);
    process.exit(1);
  }
  for (const file of files.filter((name) => name.endsWith(".js"))) {
    if (readFileSync(`.next/${file}`, "utf8").includes("ZodError")) zodChunks.push(`${entry}: ${file}`);
  }
}
if (zodChunks.length > 0) {
  console.error(`Zod w JS stron publicznych (#390):\n  ${zodChunks.join("\n  ")}`);
  process.exit(1);
}
console.log(`Build .next kompletny (BUILD_ID ${buildId}).`);
