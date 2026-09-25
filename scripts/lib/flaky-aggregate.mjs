// Agregacja raportów JSON Playwrighta z kilku przebiegów (issue #375). Czysty moduł
// (bez I/O) — używa go `scripts/e2e-flaky-report.mjs` i test `tests/unit/flaky-aggregate.test.ts`.
//
// Test jest NIESTABILNY, gdy w zebranych przebiegach ma różne wyniki: przynajmniej raz
// przeszedł i przynajmniej raz padł (także „flaky” w jednym przebiegu = padł, a przeszedł
// dopiero przy ponowieniu). Test, który padł w KAŻDYM przebiegu, jest stabilnie czerwony —
// to realny błąd, nie flak, więc raportujemy go osobno. Pominięte próby się nie liczą.

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function firstLine(message) {
  return (message ?? '').replace(ANSI, '').split('\n')[0]?.trim() ?? '';
}

/** Wszystkie specy z drzewa `suites` raportu (zagnieżdżone describe). */
function collectSpecs(suites, parents = [], out = []) {
  for (const suite of suites ?? []) {
    // Najwyższy poziom = plik (tytuł to ścieżka) — nie wchodzi do tytułu testu.
    const path = suite.file && suite.title === suite.file ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) out.push({ spec, path });
    collectSpecs(suite.suites, path, out);
  }
  return out;
}

/**
 * Wynik jednego testu (projekt × spec) w jednym przebiegu.
 * @returns {'passed'|'failed'|'flaky'|'skipped'}
 */
function outcomeOf(test) {
  if (test.status === 'skipped') return 'skipped';
  if (test.status === 'flaky') return 'flaky';
  if (test.status === 'expected') return 'passed';
  return 'failed';
}

/**
 * Zbiera przebiegi w mapę testów.
 * @param {Array<{ name: string, report: any }>} runs raporty JSON (`--reporter=json`)
 */
export function aggregateRuns(runs) {
  const tests = new Map();
  for (const { name, report } of runs) {
    if (!report || !Array.isArray(report.suites)) {
      throw new Error(`${name}: to nie jest raport JSON Playwrighta (brak "suites")`);
    }
    for (const { spec, path } of collectSpecs(report.suites)) {
      for (const test of spec.tests ?? []) {
        const project = test.projectName ?? '';
        const title = [...path, spec.title].filter(Boolean).join(' › ');
        const key = `${project}|${spec.file}:${spec.line}|${title}`;
        const entry = tests.get(key) ?? {
          key,
          project,
          file: spec.file,
          line: spec.line,
          title,
          runs: [],
        };
        const errors = (test.results ?? [])
          .filter((result) => result.status !== 'passed' && result.status !== 'skipped')
          .map((result) => firstLine(result.error?.message ?? result.errors?.[0]?.message))
          .filter(Boolean);
        entry.runs.push({ run: name, outcome: outcomeOf(test), errors });
        tests.set(key, entry);
      }
    }
  }
  return [...tests.values()];
}

/**
 * Klasyfikacja zagregowanych testów.
 * @returns {{ runs: number, total: number, flaky: any[], failing: any[] }}
 */
export function classify(entries, runCount) {
  const flaky = [];
  const failing = [];
  for (const entry of entries) {
    const counted = entry.runs.filter((run) => run.outcome !== 'skipped');
    if (counted.length === 0) continue;
    const passed = counted.filter((run) => run.outcome === 'passed').length;
    const failed = counted.filter((run) => run.outcome === 'failed').length;
    const flakyRuns = counted.filter((run) => run.outcome === 'flaky').length;
    const summary = {
      ...entry,
      passed,
      failed,
      flakyRuns,
      errors: [...new Set(counted.flatMap((run) => run.errors))],
    };
    if (flakyRuns > 0 || (passed > 0 && failed > 0)) flaky.push(summary);
    else if (failed === counted.length) failing.push(summary);
  }
  const byInstability = (a, b) =>
    b.failed + b.flakyRuns - (a.failed + a.flakyRuns) || a.key.localeCompare(b.key);
  return {
    runs: runCount,
    total: entries.length,
    flaky: flaky.sort(byInstability),
    failing: failing.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Raport tekstowy (stdout). */
export function formatReport(result) {
  const lines = [`Przebiegi: ${result.runs}, testy: ${result.total}`];
  const describe = (entry) => {
    const where = `${entry.file}:${entry.line}${entry.project ? ` [${entry.project}]` : ''}`;
    const counts = `zielony ${entry.passed}×, czerwony ${entry.failed}×` +
      (entry.flakyRuns ? `, flaky ${entry.flakyRuns}×` : '');
    return [`  - ${where} ${entry.title} (${counts})`, ...entry.errors.map((e) => `      ${e}`)];
  };
  if (result.flaky.length === 0) {
    lines.push('Niestabilne testy: brak.');
  } else {
    lines.push(`Niestabilne testy (różny wynik między przebiegami): ${result.flaky.length}`);
    for (const entry of result.flaky) lines.push(...describe(entry));
  }
  if (result.failing.length > 0) {
    lines.push(`Czerwone w każdym przebiegu (realny błąd, nie flak): ${result.failing.length}`);
    for (const entry of result.failing) lines.push(...describe(entry));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Wyciąga raport JSON ze stdout `playwright test --reporter=json` (gdyby coś innego
 * wypisało się przed nim, np. log globalSetup).
 */
export function parseReportOutput(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/^\{\s*"config"/m);
    if (start === -1) throw new Error('brak raportu JSON w wyjściu Playwrighta');
    return JSON.parse(trimmed.slice(start));
  }
}
