import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Test spójności tłumaczeń (next-intl).
 *
 * Wczytuje src/messages/{pl,nl,fr,en}.json i sprawdza, że wszystkie mają IDENTYCZNY
 * zbiór kluczy (rekurencyjnie, po pełnych ścieżkach z kropkami). Wykrywa klucze
 * brakujące oraz nadmiarowe w dowolnym pliku. W razie różnic test kończy się
 * niepowodzeniem z czytelną listą rozbieżności.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof LOCALES)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Zbiera pełne ścieżki liści (klucze rozdzielone kropką). */
function collectKeys(value: unknown, prefix = ''): string[] {
  if (!isPlainObject(value)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child)) {
      keys.push(...collectKeys(child, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function loadMessages(locale: Locale): unknown {
  const file = resolve(process.cwd(), 'src', 'messages', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

describe('spójność kluczy tłumaczeń (pl/nl/fr/en)', () => {
  const keySets = new Map<Locale, Set<string>>();

  for (const locale of LOCALES) {
    const parsed = loadMessages(locale);
    expect(isPlainObject(parsed), `${locale}.json musi być obiektem JSON`).toBe(true);
    keySets.set(locale, new Set(collectKeys(parsed)));
  }

  // Suma wszystkich kluczy występujących w którymkolwiek pliku.
  const union = new Set<string>();
  for (const set of keySets.values()) {
    for (const key of set) {
      union.add(key);
    }
  }

  it('każdy plik zawiera co najmniej jeden klucz', () => {
    for (const [locale, set] of keySets) {
      expect(set.size, `${locale}.json nie zawiera żadnych kluczy`).toBeGreaterThan(0);
    }
  });

  it('wszystkie pliki mają identyczny zbiór kluczy', () => {
    const differences: string[] = [];

    for (const [locale, set] of keySets) {
      const missing = [...union].filter((key) => !set.has(key)).sort();
      if (missing.length > 0) {
        differences.push(`[${locale}] brakuje ${missing.length}: ${missing.join(', ')}`);
      }
    }

    expect(
      differences,
      `Zbiory kluczy tłumaczeń różnią się między językami:\n${differences.join('\n')}`,
    ).toEqual([]);
  });

  it('wszystkie pliki mają tę samą liczbę kluczy', () => {
    const counts = LOCALES.map((locale) => keySets.get(locale)?.size ?? 0);
    const unique = new Set(counts);
    expect(
      unique.size,
      `Liczby kluczy różnią się: ${LOCALES.map((l, i) => `${l}=${counts[i]}`).join(', ')}`,
    ).toBe(1);
  });
});
