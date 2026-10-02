import { z } from 'zod';

import { routing } from '@/i18n/routing';
import { LOCATION_KEYS } from '@/lib/locations/city-aliases';
import { CATEGORY_KEYS, CONTRACT_TYPES } from '@/components/public/job-filters';

/**
 * Wejście i wyjście wyszukiwania opisem (#711): kandydat opisuje, jakiej pracy szuka, a model
 * proponuje filtry listy ofert. Wejście jest ŚCISŁE — wyłącznie tekst wyszukiwania i dwa języki
 * (tekstu i interfejsu); bez CV, profilu, identyfikatorów konta ani innych pól.
 */

const locales = routing.locales as unknown as [string, ...string[]];

export const SEARCH_ASSIST_LIMITS = {
  /** Krótki opis potrzeby — nie CV. */
  textMin: 3,
  textMax: 500,
  /** Słowo kluczowe listy (tytuł oferty); lista i tak ucina do 100 znaków. */
  keyword: 60,
  /** Fragmenty pokazywane użytkownikowi (niepewne / nierozpoznane miejscowości). */
  fragment: 80,
  fragments: 5,
} as const;

export const searchAssistRequestSchema = z
  .object({
    /** Język tekstu wpisanego przez użytkownika (jawny wybór w formularzu). */
    inputLocale: z.enum(locales),
    /** Język interfejsu — w nim powstają etykiety propozycji. */
    locale: z.enum(locales),
    text: z.string().trim().min(SEARCH_ASSIST_LIMITS.textMin).max(SEARCH_ASSIST_LIMITS.textMax),
  })
  .strict();

export type SearchAssistRequest = z.infer<typeof searchAssistRequestSchema>;

export const SALARY_UNITS = ['month', 'hour'] as const;
export const ACCOMMODATION_CHOICES = ['any', 'provided', 'unavailable'] as const;
export const WORK_TIME_CHOICES = ['any', 'full_time', 'part_time'] as const;

/** Wersja kontraktu odpowiedzi modelu (zmiana schematu = nowa wersja). */
export const SEARCH_ASSIST_SCHEMA_VERSION = 'job-search-filters-v1';

/**
 * Schemat structured output. Wartości słowników jako `enum` — model nie może zaproponować
 * kategorii, miasta ani rodzaju umowy spoza portalu; serwer i tak sprawdza je drugi raz.
 * Bez typów unijnych: „brak wartości” = `0`, `""`, `[]` albo `any`.
 */
export const SEARCH_ASSIST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'suspiciousInstructions',
    'keyword',
    'categories',
    'locations',
    'unresolvedPlaces',
    'contractTypes',
    'salaryUnit',
    'salaryMin',
    'salaryMax',
    'accommodation',
    'immediate',
    'noLanguageRequired',
    'workTime',
    'uncertain',
  ],
  properties: {
    suspiciousInstructions: { type: 'boolean' },
    keyword: { type: 'string' },
    categories: { type: 'array', items: { type: 'string', enum: [...CATEGORY_KEYS] } },
    locations: { type: 'array', items: { type: 'string', enum: [...LOCATION_KEYS] } },
    unresolvedPlaces: { type: 'array', items: { type: 'string' } },
    contractTypes: { type: 'array', items: { type: 'string', enum: [...CONTRACT_TYPES] } },
    salaryUnit: { type: 'string', enum: [...SALARY_UNITS] },
    salaryMin: { type: 'integer' },
    salaryMax: { type: 'integer' },
    accommodation: { type: 'string', enum: [...ACCOMMODATION_CHOICES] },
    immediate: { type: 'boolean' },
    noLanguageRequired: { type: 'boolean' },
    workTime: { type: 'string', enum: [...WORK_TIME_CHOICES] },
    uncertain: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * Odpowiedź po walidacji kształtu. Słowniki jako zwykłe napisy — wartość spoza słownika nie
 * unieważnia całej odpowiedzi, tylko jest pomijana przez `guard.ts` (i liczona jako odrzucona).
 * Klucze spoza schematu są odrzucane (`strip`).
 */
export const searchAssistResponseSchema = z.object({
  suspiciousInstructions: z.boolean(),
  keyword: z.string(),
  categories: z.array(z.string()),
  locations: z.array(z.string()),
  unresolvedPlaces: z.array(z.string()),
  contractTypes: z.array(z.string()),
  salaryUnit: z.string(),
  salaryMin: z.number(),
  salaryMax: z.number(),
  accommodation: z.string(),
  immediate: z.boolean(),
  noLanguageRequired: z.boolean(),
  workTime: z.string(),
  uncertain: z.array(z.string()),
});

export type SearchAssistResponse = z.infer<typeof searchAssistResponseSchema>;
