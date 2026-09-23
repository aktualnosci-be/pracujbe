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
console.log(`Build .next kompletny (BUILD_ID ${buildId}).`);
