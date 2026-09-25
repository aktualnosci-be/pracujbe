#!/usr/bin/env node
// Raport niestabilnych testów E2E z kilku LOKALNYCH przebiegów (issue #375). Poza CI.
//
// Uruchomienie N przebiegów (bez ponowień, każdy z raportem JSON), potem raport:
//   node scripts/e2e-flaky-report.mjs --runs 5 [--out katalog] [-- argumenty playwright]
//   np. node scripts/e2e-flaky-report.mjs --runs 3 -- tests/e2e/smoke.spec.ts --workers=4
// Sama agregacja gotowych raportów (np. z innych maszyn, `--reporter=json`):
//   node scripts/e2e-flaky-report.mjs raport-1.json raport-2.json …
//
// Kod wyjścia: 0 — brak niestabilnych testów; 1 — są niestabilne (lista na stdout);
// 2 — błąd użycia. Testy czerwone w każdym przebiegu są wypisywane osobno i nie
// zmieniają kodu wyjścia (to realny błąd — widać go w zwykłym przebiegu).
// Opis: docs/E2E_FLAKY_REPORT.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateRuns, classify, formatReport, parseReportOutput } from './lib/flaky-aggregate.mjs';

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Użycie: node scripts/e2e-flaky-report.mjs --runs N [--out katalog] [-- argumenty playwright]\n' +
      '        node scripts/e2e-flaky-report.mjs raport.json [raport.json …]',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const playwrightArgs = sep === -1 ? [] : argv.slice(sep + 1);
  let runs = 0;
  // Nie w test-results/: Playwright czyści ten katalog na starcie każdego przebiegu.
  let out = 'playwright-report/flaky-runs';
  const files = [];
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    if (arg === '--runs') runs = Number(own[++i]);
    else if (arg === '--out') out = own[++i] ?? '';
    else if (arg === '--help' || arg === '-h') usage();
    else if (arg.startsWith('-')) usage(`Nieznana opcja: ${arg}`);
    else files.push(arg);
  }
  if (files.length > 0 && runs) usage('Podaj --runs ALBO pliki raportów, nie oba.');
  if (files.length === 0 && !(Number.isInteger(runs) && runs >= 2)) {
    usage('--runs musi być liczbą całkowitą ≥ 2 (albo podaj pliki raportów).');
  }
  if (!out) usage('--out wymaga katalogu.');
  for (const arg of playwrightArgs) {
    if (/^--(reporter|retries)(=|$)/.test(arg)) {
      usage(`${arg}: skrypt sam ustawia --reporter=json i --retries=0.`);
    }
  }
  return { runs, out, files, playwrightArgs };
}

function runPlaywright(index, total, out, playwrightArgs) {
  const name = `run-${String(index).padStart(2, '0')}`;
  console.error(`>> przebieg ${index}/${total}`);
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--reporter=json', '--retries=0', ...playwrightArgs],
    // CI nie ustawiamy: lokalnie serwer jest używany ponownie (reuseExistingServer).
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (result.error) throw result.error;
  let report;
  try {
    report = parseReportOutput(result.stdout ?? '');
  } catch {
    // Kod != 0 przy czerwonym teście jest oczekiwany; brak raportu (np. zła konfiguracja) już nie.
    console.error(`${name}: Playwright zakończył się kodem ${result.status} bez raportu JSON.`);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const file = join(out, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(report)}\n`);
  return { name, report };
}

const { runs, out, files, playwrightArgs } = parseArgs(process.argv.slice(2));
let collected;
if (files.length > 0) {
  collected = files.map((file) => ({ name: file, report: JSON.parse(readFileSync(file, 'utf8')) }));
} else {
  collected = [];
  for (let i = 1; i <= runs; i += 1) collected.push(runPlaywright(i, runs, out, playwrightArgs));
}

const result = classify(aggregateRuns(collected), collected.length);
process.stdout.write(formatReport(result));
if (files.length === 0) {
  mkdirSync(out, { recursive: true });
  const summaryFile = join(out, 'flaky-summary.json');
  writeFileSync(summaryFile, `${JSON.stringify(result, null, 2)}\n`);
  console.error(`Raporty przebiegów i podsumowanie: ${out}/`);
}
process.exit(result.flaky.length > 0 ? 1 : 0);
