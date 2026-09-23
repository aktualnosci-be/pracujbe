import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isLocale, routing } from '@/i18n/routing';
import { localeSchema } from '@/lib/validation/auth';

/**
 * Lista języków ma jedno źródło w kodzie aplikacji: `routing.locales` (#29). Dodanie
 * RO/UK nie może wymagać szukania kopii listy po plikach — kopia rozjeżdża się z routingiem
 * po cichu (np. walidacja odrzuca nowy język albo fallback go pomija).
 */
const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');
// Tłumaczenia i dane demonstracyjne zawierają kody języków jako treść, nie jako listę języków serwisu.
const EXCLUDED = ['src/messages/', 'src/lib/data/demo.ts', 'src/i18n/routing.ts'];
// Dwa kolejne literały kodów języka serwisu w liście, np. ['pl', 'nl' … lub "fr","en".
const LIST_LITERAL = /(['"])(pl|nl|fr|en)\1\s*,\s*(['"])(pl|nl|fr|en)\3/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('jedno źródło listy języków (#29)', () => {
  it('kod aplikacji nie powtarza listy języków poza src/i18n/routing.ts', () => {
    const offenders = files(SRC)
      .map((path) => relative(ROOT, path).replaceAll('\\', '/'))
      .filter((path) => !EXCLUDED.some((prefix) => path.startsWith(prefix)))
      .filter((path) => LIST_LITERAL.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('isLocale i localeSchema akceptują dokładnie routing.locales', () => {
    for (const locale of routing.locales) {
      expect(isLocale(locale)).toBe(true);
      expect(localeSchema.safeParse(locale).success).toBe(true);
    }
    for (const value of ['', 'PL', 'de', 'ro', 'uk', 'pl-PL', null, undefined, 1]) {
      expect(isLocale(value)).toBe(false);
      expect(localeSchema.safeParse(value).success).toBe(false);
    }
  });
});
