import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Strażnik wspólnego czekania na „gotową” stronę w E2E (flaki CI przy `failOnFlakyTests`,
 * 09.2026): axe uruchomiony po nawigacji klienckiej, zanim dotarł strumieniowany `<title>`
 * (`document-title`), dwa `meta[name="robots"]` naraz po nawigacji klienckiej i `ECONNRESET`
 * na współdzielonym keep-alive agenta HTTP Playwrighta.
 *
 * - spec importuje `AxeBuilder` z `tests/e2e/fixtures/axe.ts` (czeka na tytuł przed
 *   `analyze()`), a nie wprost z `@axe-core/playwright`;
 * - serwer E2E ma keep-alive dłuższy niż domyślne 5 s Node.
 */

const ROOT = resolve(__dirname, '../..');
const E2E = join(ROOT, 'tests/e2e');

/**
 * Speci zmieniane w PR-ach otwartych w chwili wprowadzenia helpera (#586: admin-breaches,
 * panel-a11y; #918: admin-a11y, admin-ux). Lista tylko maleje: po scaleniu tych PR-ów przenieść
 * import na `./fixtures/axe` i usunąć spec stąd.
 */
const PENDING_PR_SPECS = new Set([
  'admin-a11y.spec.ts',
  'admin-breaches.spec.ts',
  'admin-ux.spec.ts',
  'panel-a11y.spec.ts',
]);

const RAW_AXE_IMPORT = /from ['"]@axe-core\/playwright['"]/;

function specFiles(): string[] {
  return readdirSync(E2E).filter((name) => name.endsWith('.spec.ts'));
}

describe('E2E: axe dopiero na gotowej stronie', () => {
  it('speci importują AxeBuilder z fixtures/axe, nie wprost z @axe-core/playwright', () => {
    const offenders = specFiles().filter(
      (name) => !PENDING_PR_SPECS.has(name) && RAW_AXE_IMPORT.test(readFileSync(join(E2E, name), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('lista przejściowa nie zawiera speców, które już używają helpera', () => {
    const stale = [...PENDING_PR_SPECS].filter((name) => {
      try {
        return !RAW_AXE_IMPORT.test(readFileSync(join(E2E, name), 'utf8'));
      } catch {
        return false; // plik jeszcze nie istnieje na tej gałęzi
      }
    });
    expect(stale).toEqual([]);
  });

  it('helper czeka na <title> przed analizą axe', () => {
    const helper = readFileSync(join(E2E, 'fixtures/axe.ts'), 'utf8');
    const body = helper.slice(helper.indexOf('override async analyze()'));
    const wait = body.indexOf('await waitForDocumentTitle(this.readyPage)');
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(body.indexOf('super.analyze()'));
  });

  it('kontrola ujemna: bezpośredni import axe w specu zostałby wykryty', () => {
    expect(RAW_AXE_IMPORT.test("import AxeBuilder from '@axe-core/playwright';")).toBe(true);
    expect(RAW_AXE_IMPORT.test('import AxeBuilder from "@axe-core/playwright";')).toBe(true);
    expect(RAW_AXE_IMPORT.test("import AxeBuilder from './fixtures/axe';")).toBe(false);
  });

  it('serwer E2E ma keep-alive dłuższy niż domyślne 5 s (ECONNRESET agenta Playwrighta)', () => {
    const config = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8');
    const ms = Number(config.match(/const SERVER_KEEP_ALIVE_MS = ([\d_]+);/)?.[1]?.replace(/_/g, ''));
    expect(ms).toBeGreaterThanOrEqual(60_000);
    const command = config.slice(config.indexOf('webServer:'), config.indexOf('url: BASE_URL'));
    expect(command.match(/--keepAliveTimeout \$\{SERVER_KEEP_ALIVE_MS\}/g)).toHaveLength(2);
  });
});
