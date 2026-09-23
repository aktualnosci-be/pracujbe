import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Komunikaty walidacji (Zod) to klucze i18n w postaci `<namespace>.error.<klucz>`,
 * tłumaczone pełną ścieżką przez `t(message)`. Test wyszukuje każdy taki literał w `src/`
 * i sprawdza, że klucz istnieje we wszystkich plikach `src/messages/*.json` — inaczej
 * użytkownik zobaczyłby surowy klucz (Invarianty #2 i #8, issue #236).
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
const SRC = resolve(process.cwd(), 'src');
const ERROR_KEY = /['"`]([a-zA-Z]+\.error\.[a-zA-Z]+)['"`]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Record<string, unknown>)[part];
  }, messages);
}

const usedKeys = new Set<string>();
for (const file of sourceFiles(SRC)) {
  for (const [, key] of readFileSync(file, 'utf-8').matchAll(ERROR_KEY)) {
    if (key) usedKeys.add(key);
  }
}

describe('klucze komunikatów walidacji istnieją w tłumaczeniach', () => {
  it('znajduje komunikaty application.error.* i offer.error.*', () => {
    const keys = [...usedKeys];
    expect(keys.some((key) => key.startsWith('application.error.'))).toBe(true);
    expect(keys.some((key) => key.startsWith('offer.error.'))).toBe(true);
  });

  for (const locale of LOCALES) {
    it(`każdy klucz <ns>.error.* ma niepusty tekst w ${locale}.json`, () => {
      const messages: unknown = JSON.parse(
        readFileSync(join(SRC, 'messages', `${locale}.json`), 'utf-8'),
      );
      const missing = [...usedKeys]
        .filter((key) => {
          const value = lookup(messages, key);
          return typeof value !== 'string' || value.trim() === '';
        })
        .sort();

      expect(missing, `Brakujące klucze w ${locale}.json`).toEqual([]);
    });
  }
});
