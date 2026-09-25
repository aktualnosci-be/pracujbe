import { z } from 'zod';

import { routing } from '@/i18n/routing';
import { JOB_ITEM_LIMITS } from '@/lib/validation/job';

/**
 * Wejście i wyjście asystenta redagowania oferty (#37).
 *
 * Wejście jest ŚCISŁE (`strict`) — akcja przyjmuje wyłącznie tekst oferty pisany przez
 * pracodawcę (tytuł jako kontekst + pola do poprawy). Nie ma tu miejsca na dane kandydatów,
 * identyfikatory ani inne pola kreatora; klucz spoza listy = odrzucenie żądania.
 */

const locales = routing.locales as unknown as [string, ...string[]];

/** Limity wejścia = limity kreatora (step5Schema/step6Schema). */
export const ASSIST_LIMITS = {
  title: 200,
  description: 5000,
  items: 20,
  line: JOB_ITEM_LIMITS.line,
  requirement: JOB_ITEM_LIMITS.requirement,
} as const;

/** Minimalna ilość tekstu — asystent poprawia tekst pracodawcy, nie pisze oferty od zera. */
export const ASSIST_MIN_DESCRIPTION = 30;

const items = (max: number) => z.array(z.string().trim().min(1).max(max)).max(ASSIST_LIMITS.items);

export const assistRequestSchema = z
  .object({
    /** Język treści oferty (`jobs.default_locale`) — propozycja w tym samym języku. */
    locale: z.enum(locales),
    title: z.string().trim().max(ASSIST_LIMITS.title).default(''),
    fields: z
      .object({
        description: z.string().trim().max(ASSIST_LIMITS.description).optional(),
        responsibilities: items(ASSIST_LIMITS.line).optional(),
        requirementsMandatory: items(ASSIST_LIMITS.requirement).optional(),
      })
      .strict(),
  })
  .strict();

export type AssistRequest = z.infer<typeof assistRequestSchema>;

/**
 * Schemat structured output. Wszystkie pola wymagane, `additionalProperties: false`, bez
 * typów unijnych (jak `JOB_EXTRACTION_JSON_SCHEMA`). Brak propozycji = `""` / `[]`.
 */
export const ASSIST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suspiciousInstructions', 'wrongLanguage', 'description', 'responsibilities', 'requirementsMandatory'],
  properties: {
    suspiciousInstructions: { type: 'boolean' },
    wrongLanguage: { type: 'boolean' },
    description: { type: 'string' },
    responsibilities: { type: 'array', items: { type: 'string' } },
    requirementsMandatory: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** Odpowiedź modelu po walidacji (klucze spoza schematu są odrzucane — `strip`). */
export const assistResponseSchema = z.object({
  suspiciousInstructions: z.boolean(),
  wrongLanguage: z.boolean(),
  description: z.string(),
  responsibilities: z.array(z.string()),
  requirementsMandatory: z.array(z.string()),
});

export type AssistResponse = z.infer<typeof assistResponseSchema>;
