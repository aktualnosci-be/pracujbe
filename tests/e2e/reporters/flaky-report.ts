import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/**
 * Raport niestabilnych testów (issue #375).
 *
 * Test „flaky” = padł, a przeszedł dopiero przy ponowieniu. Playwright liczy go jako
 * sukces, więc bez tego raportu ponowienia ukrywały niestabilność. Reporter:
 * - wypisuje listę flaków z błędem nieudanej próby na stdout,
 * - dopisuje ją do podsumowania joba GitHub Actions (`GITHUB_STEP_SUMMARY`),
 * - zapisuje `test-results/flaky-tests.json` (także pusty — ślad, że raport powstał).
 * Status przebiegu ustala `failOnFlakyTests` w playwright.config.ts, nie ten reporter.
 */

const REPORT_FILE = 'test-results/flaky-tests.json';

interface FlakyEntry {
  title: string;
  file: string;
  line: number;
  attempts: number;
  errors: string[];
}

function firstLine(message: string | undefined): string {
  // Komunikaty Playwrighta mają kody ANSI i wielolinijkowe diffy — do tabeli wystarczy pierwsza linia.
  // eslint-disable-next-line no-control-regex
  return (message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]?.trim() ?? '';
}

function toEntry(test: TestCase): FlakyEntry {
  return {
    title: test.titlePath().filter(Boolean).slice(1).join(' › '),
    file: test.location.file.replace(`${process.cwd()}/`, ''),
    line: test.location.line,
    attempts: test.results.length,
    errors: test.results
      .filter((result) => result.status !== 'passed' && result.status !== 'skipped')
      .map((result) => `#${result.retry + 1} ${result.status}: ${firstLine(result.error?.message)}`),
  };
}

export default class FlakyReporter implements Reporter {
  private root: Suite | undefined;

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  onEnd(_result: FullResult): void {
    const flaky = (this.root?.allTests() ?? []).filter((test) => test.outcome() === 'flaky').map(toEntry);

    mkdirSync(dirname(REPORT_FILE), { recursive: true });
    writeFileSync(REPORT_FILE, `${JSON.stringify({ flaky }, null, 2)}\n`);

    if (flaky.length === 0) return;

    console.log(`\n${flaky.length} niestabilnych testów (przeszły dopiero przy ponowieniu):`);
    for (const entry of flaky) {
      console.log(`  - ${entry.file}:${entry.line} ${entry.title}`);
      for (const error of entry.errors) console.log(`      ${error}`);
    }

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    const escape = (text: string) => text.replaceAll('|', '\\|');
    const rows = flaky.map(
      (entry) =>
        `| \`${entry.file}:${entry.line}\` | ${escape(entry.title)} | ${entry.attempts} | ${escape(entry.errors.join('<br>'))} |`,
    );
    appendFileSync(
      summary,
      [
        `### Niestabilne testy E2E: ${flaky.length}`,
        '',
        'Przeszły dopiero przy ponowieniu — przebieg jest czerwony (`failOnFlakyTests`). Napraw przyczynę, nie dokładaj ponowień.',
        '',
        '| plik | test | próby | błędy nieudanych prób |',
        '| --- | --- | --- | --- |',
        ...rows,
        '',
      ].join('\n'),
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
