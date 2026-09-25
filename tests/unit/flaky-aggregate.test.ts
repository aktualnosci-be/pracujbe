import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  aggregateRuns,
  classify,
  formatReport,
  parseReportOutput,
} from '../../scripts/lib/flaky-aggregate.mjs';

/**
 * Raport flaków z kilku lokalnych przebiegów (#375, `scripts/e2e-flaky-report.mjs`).
 * Fixture'y = prawdziwe raporty `playwright test --reporter=json` (Playwright 1.61,
 * skrócone o ścieżki i czasy) dwóch przebiegów tego samego pliku: test „niestabilny”
 * pada w pierwszym i przechodzi w drugim, „zawsze czerwony” pada w obu, jeden pominięty.
 */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures/flaky-report', name), 'utf8'));

const run1 = { name: 'run-01', report: fixture('run-01.json') };
const run2 = { name: 'run-02', report: fixture('run-02.json') };

describe('flaky-aggregate (#375)', () => {
  it('test z różnym wynikiem między przebiegami = niestabilny; zawsze czerwony osobno', () => {
    const result = classify(aggregateRuns([run1, run2]), 2);
    expect(result.total).toBe(4);
    expect(result.flaky.map((entry) => entry.title)).toEqual(['grupa › niestabilny']);
    expect(result.flaky[0]).toMatchObject({ file: 'demo.spec.mjs', line: 6, passed: 1, failed: 1 });
    expect(result.flaky[0]?.errors).toEqual(['Error: pierwszy przebieg pada']);
    expect(result.failing.map((entry) => entry.title)).toEqual(['grupa › zawsze czerwony']);
  });

  it('kontrola ujemna: te same przebiegi bez zmiany wyniku nie dają flaka', () => {
    // Dwa razy ten sam przebieg (stabilne wyniki) — „niestabilny” jest wtedy stale czerwony.
    const result = classify(aggregateRuns([run1, { ...run1, name: 'run-01b' }]), 2);
    expect(result.flaky).toEqual([]);
    expect(result.failing.map((entry) => entry.title).sort()).toEqual([
      'grupa › niestabilny',
      'grupa › zawsze czerwony',
    ]);
    const stable = classify(aggregateRuns([run2, { ...run2, name: 'run-02b' }]), 2);
    expect(stable.flaky).toEqual([]);
  });

  it('status „flaky” z ponowień w jednym przebiegu też jest niestabilnością', () => {
    const report = structuredClone(run2.report);
    const spec = report.suites[0].suites[0].specs.find((s: { title: string }) => s.title === 'stabilny');
    spec.tests[0].status = 'flaky';
    spec.tests[0].results = [
      { status: 'failed', retry: 0, error: { message: 'Error: timeout\n  at …' } },
      { status: 'passed', retry: 1 },
    ];
    const result = classify(aggregateRuns([{ name: 'ci', report }]), 1);
    expect(result.flaky.map((entry) => entry.title)).toContain('grupa › stabilny');
    expect(result.flaky.find((entry) => entry.title === 'grupa › stabilny')?.errors).toEqual(['Error: timeout']);
  });

  it('raport tekstowy wymienia plik, linię i liczniki', () => {
    const text = formatReport(classify(aggregateRuns([run1, run2]), 2));
    expect(text).toContain('Przebiegi: 2, testy: 4');
    expect(text).toContain('demo.spec.mjs:6 grupa › niestabilny (zielony 1×, czerwony 1×)');
    expect(text).toContain('Czerwone w każdym przebiegu');
  });

  it('odrzuca plik, który nie jest raportem JSON Playwrighta', () => {
    expect(() => aggregateRuns([{ name: 'x.json', report: { foo: 1 } }])).toThrow(/suites/);
  });

  it('wyciąga raport ze stdout także po obcym logu', () => {
    const report = { config: {}, suites: [] };
    expect(parseReportOutput(JSON.stringify(report))).toEqual(report);
    expect(parseReportOutput(`log globalSetup\n${JSON.stringify(report, null, 2)}`)).toEqual(report);
    expect(() => parseReportOutput('nic')).toThrow(/brak raportu/);
  });
});
