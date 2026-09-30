// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildKeyUsageIndex,
  flattenMessageKeys,
  isKeyPossiblyUsed,
  listSourceFiles,
} from '../helpers/i18n-source-scan';

/**
 * Invariant #2 (#1114, TQ2-09): klucz tłumaczenia, którego kod nie może użyć, jest martwy —
 * nieużywane teksty rozjeżdżają się z produktem i mylą tłumaczy (np. obietnice funkcji
 * wyłączonych w trybie ogłoszeniowym). Heurystyka jest ostrożna (bez fałszywych alarmów):
 * klucz uznajemy za używany, gdy jego ostatni człon występuje w `src/` albo `scripts/` jako
 * identyfikator lub fragment literału, albo pasuje do klucza dynamicznego (`landing.cat_${x}`,
 * `${key}Title`). Test wykrywa więc klucze, których NIC w kodzie nie może zbudować.
 *
 * Wyjątki: tylko klucze zachowane świadomie, z powodem. Wpis nieaktualny (klucz użyty albo
 * usunięty) też psuje test.
 */

const ROOT = process.cwd();

/** Klucz → powód zachowania mimo braku użycia w kodzie aplikacji. */
const KEPT_UNUSED: ReadonlyMap<string, string> = new Map([
  // #51: dawne teksty sprzedaży są wzorcami, których NIE może być na stronie
  // (tests/e2e/free-mvp-no-sales.spec.ts, 4 języki). Usunięcie = razem z tym testem.
  // (`billing.plansTitle` z tego testu heurystyka uznaje za możliwie używany — bez wpisu.)
  ['billing.choosePlan', 'free-mvp-no-sales'],
  ['dashboard.yourPackage', 'free-mvp-no-sales'],
  ['dashboard.changePackage', 'free-mvp-no-sales'],
  ['dashboard.navPayments', 'free-mvp-no-sales'],
  ['pricing.popular', 'free-mvp-no-sales'],
]);

function sources() {
  return [
    ...listSourceFiles(resolve(ROOT, 'src'), new Set(['messages'])),
    ...listSourceFiles(resolve(ROOT, 'scripts')),
  ].map((fileName) => ({ fileName, source: readFileSync(fileName, 'utf8') }));
}

const keys = flattenMessageKeys(JSON.parse(readFileSync(resolve(ROOT, 'src/messages/pl.json'), 'utf8')));
const index = buildKeyUsageIndex(sources());

describe('nieużywane klucze tłumaczeń (Invariant #2)', () => {
  it('analiza widzi realne użycia (literał, klucz dynamiczny z początkiem i z końcem)', () => {
    expect(keys.length).toBeGreaterThan(1000);
    // Literał: t('heroTitleLine1'); początek: t(`cat_${key}`); koniec: t(`${key}Title`).
    expect(isKeyPossiblyUsed('home.heroTitleLine1', index)).toBe(true);
    expect(isKeyPossiblyUsed('landing.cat_construction', index)).toBe(true);
    expect(isKeyPossiblyUsed('employers.contactChannelTitle', index)).toBe(true);
  });

  it('każdy klucz spoza listy wyjątków może zostać użyty przez kod', () => {
    const unused = keys.filter((key) => !KEPT_UNUSED.has(key) && !isKeyPossiblyUsed(key, index));
    expect(unused, 'usuń klucz ze WSZYSTKICH plików src/messages/*.json albo użyj go w kodzie').toEqual([]);
  });

  it('lista wyjątków jest aktualna (klucz istnieje i nadal nie jest używany)', () => {
    for (const key of KEPT_UNUSED.keys()) {
      expect(keys, key).toContain(key);
      expect(isKeyPossiblyUsed(key, index), `${key} jest używany — usuń wpis z KEPT_UNUSED`).toBe(false);
    }
  });

  it('kontrola ujemna: dopisany klucz, którego nic nie buduje, jest wykrywany', () => {
    const extra = 'home.orphanKeyWithoutAnyUsage1114';
    expect(isKeyPossiblyUsed(extra, index)).toBe(false);
    const synthetic = buildKeyUsageIndex([
      { fileName: 'a.tsx', source: "const t = useTranslations('home'); export const x = t('usedKey');" },
      { fileName: 'b.ts', source: 'export const k = (s: string) => `status_${s}` + `${s}Label`;' },
    ]);
    expect(isKeyPossiblyUsed('home.usedKey', synthetic)).toBe(true);
    expect(isKeyPossiblyUsed('home.status_active', synthetic)).toBe(true);
    // Koniec klucza dynamicznego wymaga słowa z kodu przed nim: `sKey` + `Label`? nie ma `sKey`.
    expect(isKeyPossiblyUsed('home.missingLabel', synthetic)).toBe(false);
    expect(isKeyPossiblyUsed('home.otherKey', synthetic)).toBe(false);
  });
});
