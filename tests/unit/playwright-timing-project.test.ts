// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #732 — projekt `chromium-timing` nie może zależeć od `chromium`: Playwright pomija projekt
 * zależny, gdy w zależności padnie dowolny test, więc pomiar INP (#393) znikałby dokładnie
 * z przebiegów, w których jest najbardziej potrzebny. Job `e2e-perf` uruchamia go osobno
 * (`--project=chromium-timing --no-deps`).
 */
function projectBlock(source: string, name: string): string {
  const start = source.indexOf(`name: '${name}'`);
  expect(start, `projekt ${name} w playwright.config.ts`).toBeGreaterThan(-1);
  const end = source.indexOf('\n    },', start);
  return source.slice(start, end);
}

describe('playwright.config.ts — projekt pomiaru czasu (#732)', () => {
  const source = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');

  it('chromium-timing nie ma dependencies (nie jest pomijany po awarii innych testów)', () => {
    const block = projectBlock(source, 'chromium-timing');
    expect(block).not.toMatch(/^\s*dependencies:/m);
    expect(block).toMatch(/workers: 1/);
    expect(block).toMatch(/testMatch: TIMING_SPECS/);
  });

  it('kontrola ujemna: projekt z zależnością od chromium byłby wykryty', () => {
    const withDependency = source.replace('workers: 1,', "workers: 1,\n      dependencies: ['chromium'],");
    expect(projectBlock(withDependency, 'chromium-timing')).toMatch(/^\s*dependencies:/m);
  });

  it('pomiar czasu biegnie bez śladu (trace zawyżałby INP), reszta zapisuje ślad dopiero przy ponowieniu (nagrywanie każdej próby wywracało Chromium w CI)', () => {
    expect(projectBlock(source, 'chromium-timing')).toMatch(/trace: 'off'/);
    expect(source).toMatch(/trace: 'on-first-retry'/);
    expect(source).not.toMatch(/retain-on-first-failure/);
  });
});
