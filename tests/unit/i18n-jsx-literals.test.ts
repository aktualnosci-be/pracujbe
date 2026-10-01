// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findJsxLiterals, listSourceFiles, type JsxLiteral } from '../helpers/i18n-source-scan';

/**
 * Invariant #2 (#1114, TQ2-09): brak tekstów UI na sztywno. Strażnik analizuje AST każdego
 * pliku `.tsx` w `src/` i zgłasza tekst z literą w treści JSX (`<p>Zapisz</p>`, `{'Zapisz'}`)
 * oraz w atrybutach widocznych dla użytkownika (`aria-label`, `title`, `alt`, `placeholder`…).
 * Tekst musi pochodzić z `src/messages/*.json` (next-intl albo `emailCopy`).
 *
 * Wyjątki są jawne i minimalne; wpis, który przestał pasować, też psuje test.
 */

const ROOT = process.cwd();

/** Cały plik poza strażnikiem — z powodem. */
const EXEMPT_FILES: ReadonlyMap<string, string> = new Map([
  // Granica błędu ROOT layoutu: renderuje się, gdy padł `[locale]/layout` (a z nim provider
  // next-intl), więc nie ma skąd wziąć tłumaczeń; pokazuje komunikat we wszystkich 4 językach.
  ['src/app/global-error.tsx', 'root error boundary poza next-intl'],
]);

/** Teksty, które nie są tłumaczeniem (znak marki, kody, stałe techniczne) — z powodem. */
const ALLOWED_VALUES: ReadonlyMap<string, string> = new Map([
  ['pracuj', 'znak marki (logo: czarne „pracuj”)'],
  ['.be', 'znak marki (logo: „.be” na czerwonym kafelku)'],
  ['Pracuj.be', 'nazwa marki w dostępnej nazwie logo'],
  ['EUR', 'kod waluty ISO 4217'],
  ['PLN', 'kod waluty ISO 4217'],
]);

/** Pojedyncze wystąpienia w konkretnym pliku — z powodem. */
const ALLOWED_IN_FILE: ReadonlyArray<{ file: string; value: string; reason: string }> = [
  { file: 'src/components/employer/JobImportPanel.tsx', value: 'https://', reason: 'podpowiedź formatu adresu URL' },
  { file: 'src/components/layout/Footer.tsx', value: 'v', reason: 'prefiks numeru wersji wydania (v1.0.0)' },
];

function isAllowed(hit: JsxLiteral): boolean {
  if (ALLOWED_VALUES.has(hit.value)) return true;
  return ALLOWED_IN_FILE.some((entry) => entry.file === hit.file && entry.value === hit.value);
}

function scanRepository(): JsxLiteral[] {
  return listSourceFiles(resolve(ROOT, 'src'))
    .filter((file) => file.endsWith('.tsx'))
    .flatMap((file) => findJsxLiterals(file, readFileSync(file, 'utf8'), ROOT));
}

const all = scanRepository();

describe('teksty UI na sztywno w JSX (Invariant #2)', () => {
  it('żaden plik .tsx w src/ nie zawiera literału tekstowego w JSX poza wyjątkami', () => {
    const offenders = all
      .filter((hit) => !EXEMPT_FILES.has(hit.file) && !isAllowed(hit))
      .map((hit) => `${hit.file}:${hit.line} [${hit.where}] ${hit.value}`);
    expect(offenders, 'przenieś tekst do src/messages/{pl,nl,fr,en}.json').toEqual([]);
  });

  it('lista wyjątków jest aktualna i minimalna (każdy wpis nadal czegoś dotyczy)', () => {
    for (const file of EXEMPT_FILES.keys()) {
      expect(all.some((hit) => hit.file === file), `${file} nie ma już literałów — usuń wyjątek`).toBe(true);
    }
    for (const value of ALLOWED_VALUES.keys()) {
      expect(all.some((hit) => hit.value === value && !EXEMPT_FILES.has(hit.file)), `„${value}” nieużywane — usuń wyjątek`).toBe(true);
    }
    for (const entry of ALLOWED_IN_FILE) {
      expect(all.some((hit) => hit.file === entry.file && hit.value === entry.value), `${entry.file}: „${entry.value}”`).toBe(true);
    }
    expect(EXEMPT_FILES.size + ALLOWED_VALUES.size + ALLOWED_IN_FILE.length).toBeLessThanOrEqual(8);
  });

  it('kontrola ujemna: tekst w treści, w wyrażeniu i w atrybucie jest wykrywany', () => {
    const source = [
      'export function Bad({ t }: { t: (k: string) => string }) {',
      '  return (',
      '    <div>',
      '      <p>Zapisz zmiany</p>',
      "      <p>{'Anuluj'}</p>",
      '      <button aria-label="Zamknij okno" title={`Pomoc`}>x</button>',
      '      <img alt="Zdjęcie" src="/a.png" />',
      '      <input placeholder="np. kierowca" />',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const hits = findJsxLiterals('src/components/Bad.tsx', source);
    expect(hits.map((hit) => [hit.where, hit.value])).toEqual([
      ['text', 'Zapisz zmiany'],
      ['text', 'Anuluj'],
      ['aria-label', 'Zamknij okno'],
      ['title', 'Pomoc'],
      ['text', 'x'],
      ['alt', 'Zdjęcie'],
      ['placeholder', 'np. kierowca'],
    ]);
    expect(hits.filter((hit) => !isAllowed(hit))).toHaveLength(7);
  });

  it('kontrola dodatnia: tłumaczenia, liczby, znaki i atrybuty techniczne nie są zgłaszane', () => {
    const source = [
      'export function Good({ t, n }: { t: (k: string) => string; n: number }) {',
      '  return (',
      '    <section className="pp-hero" data-testid="hero" id="main-content">',
      "      <h1 aria-label={t('title')}>{t('title')}</h1>",
      '      <span>{n} · 100% — 2/3</span>',
      '      <span className="pp-accent">{`${n}`}</span>',
      "      <style>{'.pp-hero{display:none}'}</style>",
      '      <script type="application/ld+json">{`{"name":"x"}`}</script>',
      '    </section>',
      '  );',
      '}',
    ].join('\n');
    expect(findJsxLiterals('src/components/Good.tsx', source)).toEqual([]);
  });
});
