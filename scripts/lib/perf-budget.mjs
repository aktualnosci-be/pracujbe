import { gzipSync } from "node:zlib";

/**
 * Wspólna logika bramki wydajności (#395): budżety z `perf-budgets.json`, JS tras
 * z `app-build-manifest.json` i mediana pomiarów laboratoryjnych. Bez I/O poza
 * przekazanym `readFile`, żeby dało się to testować na sztucznym manifeście.
 */

/** Wpisy manifestu, które przeglądarka ładuje dla strony: layouty od korzenia + sama strona. */
export function routeEntries(page) {
  if (!page.endsWith("/page"))
    throw new Error(`Oczekiwano wpisu strony (…/page): ${page}`);
  const segments = page.slice(1, -"/page".length).split("/").filter(Boolean);
  const layouts = [];
  for (let depth = 0; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join("/");
    layouts.push(prefix ? `/${prefix}/layout` : "/layout");
  }
  return [...layouts, page];
}

/** Pliki JS trasy (unikalne, w kolejności manifestu). Brak wpisu strony = błąd. */
export function routeJsFiles(pages, page) {
  if (!pages[page])
    throw new Error(`Brak wpisu ${page} w app-build-manifest.json`);
  const files = new Set();
  for (const entry of routeEntries(page)) {
    for (const file of pages[entry] ?? [])
      if (file.endsWith(".js")) files.add(file);
  }
  return [...files];
}

/** Rozmiar gzip (bajty) — gzip domyślny, jak liczy tabela `next build`. */
export function gzipSize(buffer) {
  return gzipSync(buffer).length;
}

export function kb(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

/**
 * Porównanie JS tras z budżetem. `readFile(path)` czyta plik względem `.next/`.
 * Zwraca wiersze raportu; `ok: false` = przekroczony budżet.
 */
export function checkRouteBudgets(pages, budgets, readFile) {
  const cache = new Map();
  const size = (file) => {
    if (!cache.has(file)) cache.set(file, gzipSize(readFile(file)));
    return cache.get(file);
  };
  return Object.entries(budgets).map(([page, budgetKb]) => {
    const files = routeJsFiles(pages, page);
    const bytes = files.reduce((sum, file) => sum + size(file), 0);
    return {
      name: page,
      actualKb: kb(bytes),
      budgetKb,
      ok: kb(bytes) <= budgetKb,
    };
  });
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** CLS jak w Core Web Vitals: największe okno sesji (przerwa ≤ 1 s, okno ≤ 5 s). */
export function clsFromShifts(shifts) {
  let max = 0;
  let current = 0;
  let windowStart = -Infinity;
  let last = -Infinity;
  for (const { t, v } of shifts) {
    if (t - last > 1000 || t - windowStart > 5000) {
      current = 0;
      windowStart = t;
    }
    current += v;
    last = t;
    max = Math.max(max, current);
  }
  return max;
}

/** TBT: część każdego long taska po FCP ponad 50 ms. */
export function tbtFromLongtasks(longtasks, fcp) {
  return longtasks.reduce((sum, { t, d }) => {
    const start = Math.max(t, fcp);
    const blocking = t + d - start - 50;
    return sum + (t + d > fcp && blocking > 0 ? blocking : 0);
  }, 0);
}

/** Tabela Markdown dla `$GITHUB_STEP_SUMMARY`. */
export function markdownTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map(line),
  ].join("\n");
}

/**
 * INP-proxy jednej interakcji z wpisów Event Timing (`{ interactionId, duration }`):
 * jak INP w Chromium — czas interakcji = najdłuższy wpis z tym samym `interactionId`
 * (pointerdown/pointerup/click jednego tapnięcia), a wynik = najdłuższa interakcja.
 * Wpisy bez `interactionId` (np. pointermove) się nie liczą. Brak wpisów = 0: API zgłasza
 * tylko zdarzenia ≥ `durationThreshold` (16 ms), więc interakcja była krótsza.
 */
export function inpFromEventEntries(entries) {
  const byInteraction = new Map();
  for (const { interactionId, duration } of entries) {
    if (!interactionId) continue;
    byInteraction.set(
      interactionId,
      Math.max(byInteraction.get(interactionId) ?? 0, duration),
    );
  }
  return Math.max(0, ...byInteraction.values());
}
