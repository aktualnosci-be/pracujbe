import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { ErrorCodes, toUserMessageKey, type ErrorCode } from '@/lib/errors';

/**
 * Test spójności kodów błędów z tłumaczeniami (Invariant #8).
 *
 * `toUserMessageKey` musi zwracać klucz i18n w formacie `errors.<camelCase>`
 * (np. `errors.authInvalidCredentials`, NIE `errors.AUTH_INVALID_CREDENTIALS`),
 * a każdy taki klucz musi istnieć w `src/messages/pl.json` w namespace `errors`.
 * Dzięki temu żaden kod błędu nie może zwrócić klucza bez tłumaczenia.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPl(): Record<string, unknown> {
  const file = resolve(process.cwd(), 'src', 'messages', 'pl.json');
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  if (!isPlainObject(parsed)) {
    throw new Error('pl.json musi być obiektem JSON');
  }
  return parsed;
}

const CODES = Object.keys(ErrorCodes) as ErrorCode[];

describe('toUserMessageKey — klucze błędów istnieją w pl.json', () => {
  const messages = loadPl();
  const errors = messages.errors;

  it('namespace "errors" istnieje w pl.json', () => {
    expect(isPlainObject(errors), 'pl.json musi zawierać obiekt "errors"').toBe(true);
  });

  it('mapuje każdy ErrorCode na klucz camelCase (nie SCREAMING_SNAKE_CASE)', () => {
    for (const code of CODES) {
      const key = toUserMessageKey(code);
      expect(key.startsWith('errors.'), `${code}: klucz musi zaczynać się od "errors."`).toBe(true);
      const suffix = key.slice('errors.'.length);
      // camelCase: brak podkreśleń i pierwszy znak małą literą (czyli nie surowy kod SCREAMING_SNAKE_CASE).
      expect(suffix, `${code}: klucz "${key}" nie jest camelCase`).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });

  it('dla każdego ErrorCode istnieje tłumaczenie errors.<camel> w pl.json', () => {
    const errorsObj = isPlainObject(errors) ? errors : {};
    const missing: string[] = [];

    for (const code of CODES) {
      const key = toUserMessageKey(code);
      const suffix = key.slice('errors.'.length);
      const value = errorsObj[suffix];
      if (typeof value !== 'string' || value.length === 0) {
        missing.push(`${code} -> ${key}`);
      }
    }

    expect(
      missing,
      `Brakuje tłumaczeń dla kodów błędów w pl.json:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
