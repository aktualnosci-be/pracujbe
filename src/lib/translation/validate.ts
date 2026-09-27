import type { Locale } from '@/i18n/routing';
import { compareFacts, extractFacts, type FactKind } from '@/lib/translation/facts';

/**
 * Walidacja odpowiedzi dostawcy przed zapisem (#32). Niezależna od dostawcy: wynik, który nie
 * przejdzie wszystkich kontroli, NIGDY nie trafia do `complete_translation_job` — zadanie
 * kończy się kodem błędu (bez treści).
 *
 * Kontrole: kształt (płaski obiekt tekstów), dokładnie te same klucze co źródło, brak pustych
 * pól, rozsądna długość, brak znaczników/znaków sterujących spoza źródła (sanitizacja), brak
 * echa granicy danych z promptu, niezmienność faktów pole po polu (`facts.ts`).
 */

export type TranslationFields = Record<string, string>;

export type ValidationCode =
  | 'invalid_shape'
  | 'missing_field'
  | 'extra_field'
  | 'empty_field'
  | 'length_out_of_range'
  | 'markup'
  | 'control_chars'
  | 'prompt_leak'
  | `facts_${FactKind}`;

export type ValidationResult =
  | { ok: true; fields: TranslationFields }
  | { ok: false; code: ValidationCode; field?: string };

export interface ValidationInput {
  source: TranslationFields;
  sourceLocale: Locale;
  targetLocale: Locale;
  output: unknown;
  protectedTerms?: readonly string[];
}

const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>/gi;
// Znaki sterujące poza \t i \n oraz znaki kierunku/zerowej szerokości (ukrywanie treści).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/u;
const PROMPT_BOUNDARY = /<\s*\/?\s*source_fields\b|\[tag removed\]/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function countMarkup(text: string): number {
  return text.match(MARKUP)?.length ?? 0;
}

export function validateTranslation(input: ValidationInput): ValidationResult {
  const { source, sourceLocale, targetLocale, output, protectedTerms = [] } = input;
  if (!isPlainObject(output)) return { ok: false, code: 'invalid_shape' };

  const sourceKeys = Object.keys(source);
  for (const key of Object.keys(output)) {
    if (!Object.hasOwn(source, key)) return { ok: false, code: 'extra_field', field: key };
  }

  const fields: TranslationFields = {};
  for (const key of sourceKeys) {
    const raw = output[key];
    if (raw === undefined) return { ok: false, code: 'missing_field', field: key };
    if (typeof raw !== 'string') return { ok: false, code: 'invalid_shape', field: key };
    const value = raw.replace(/\r\n?/g, '\n').trim().normalize('NFC');
    const src = source[key] ?? '';
    if (!value) return { ok: false, code: 'empty_field', field: key };

    if (value.length > src.length * 3 + 100 || (src.length >= 40 && value.length < src.length * 0.25)) {
      return { ok: false, code: 'length_out_of_range', field: key };
    }
    if (CONTROL.test(value)) return { ok: false, code: 'control_chars', field: key };
    if (PROMPT_BOUNDARY.test(value)) return { ok: false, code: 'prompt_leak', field: key };
    if (countMarkup(value) > countMarkup(src)) return { ok: false, code: 'markup', field: key };

    const diff = compareFacts(
      extractFacts(src, sourceLocale, protectedTerms),
      extractFacts(value, targetLocale, protectedTerms),
    );
    if (diff) return { ok: false, code: `facts_${diff}`, field: key };
    fields[key] = value;
  }
  return { ok: true, fields };
}
