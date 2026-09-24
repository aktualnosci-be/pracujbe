import { isLocale, routing, type Locale } from '@/i18n/routing';

/**
 * Pytania screeningowe oferty (#101) — wspólne typy, limity i odczyt danych z bazy.
 *
 * Moduł bez Zoda (trafia do bundla formularza aplikowania); schematy walidacji są
 * w `@/lib/validation/screening` (kreator) i `@/lib/validation/application` (odpowiedzi).
 * Limity = te same wartości co w RPC `set_job_screening_questions` / `record_screening_answers`
 * (migracja 0093) — test `screening-questions.test.ts` porównuje je z migracją.
 *
 * Odpowiedzi nie wpływają na dopasowanie ani status zgłoszenia: firma czyta je w szczególe
 * zgłoszenia (brak reguł dyskwalifikujących i brak modelu językowego).
 */

export const SCREENING_QUESTION_TYPES = ['yes_no', 'single_choice', 'date', 'short_text'] as const;
export type ScreeningQuestionType = (typeof SCREENING_QUESTION_TYPES)[number];

export const SCREENING_LIMITS = {
  questions: 10,
  prompt: 300,
  option: 120,
  optionsMin: 2,
  optionsMax: 10,
  answer: 500,
} as const;

/** Tekst w kilku językach: kod języka → treść (puste wartości pomijane). */
export type LocalizedText = Partial<Record<Locale, string>>;

export interface ScreeningOption {
  /** Identyfikator nadany przez bazę (o1…o10) — wartość odpowiedzi na pytanie wyboru. */
  id: string;
  label: LocalizedText;
}

/** Pytanie opublikowanej oferty (formularz aplikowania). */
export interface ScreeningQuestion {
  id: string;
  position: number;
  type: ScreeningQuestionType;
  required: boolean;
  prompt: LocalizedText;
  options: ScreeningOption[];
}

/** Pytanie w kreatorze (przed zapisem — id opcji nadaje baza). */
export interface ScreeningQuestionDraft {
  type: ScreeningQuestionType;
  required: boolean;
  prompt: LocalizedText;
  options: { label: LocalizedText }[];
}

/** Odpowiedź zapisana przy zgłoszeniu: snapshot pytania + wartość (pusta = brak odpowiedzi). */
export interface ScreeningAnswer {
  position: number;
  type: ScreeningQuestionType;
  required: boolean;
  prompt: LocalizedText;
  options: ScreeningOption[];
  answerBoolean: boolean | null;
  answerDate: string | null;
  answerText: string | null;
}

/** Wartość odpowiedzi wysyłana z formularza: tak/nie albo tekst (id opcji, data RRRR-MM-DD, tekst). */
export type ScreeningAnswerValue = boolean | string;

export function isScreeningQuestionType(value: unknown): value is ScreeningQuestionType {
  return typeof value === 'string' && (SCREENING_QUESTION_TYPES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Mapa z bazy → `LocalizedText` (tylko obsługiwane języki i niepuste teksty). */
export function toLocalizedText(value: unknown): LocalizedText {
  const out: LocalizedText = {};
  for (const [key, text] of Object.entries(asRecord(value))) {
    if (isLocale(key) && typeof text === 'string' && text.trim() !== '') out[key] = text;
  }
  return out;
}

function toOptions(value: unknown): ScreeningOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      id: typeof item['id'] === 'string' ? item['id'] : '',
      label: toLocalizedText(item['label']),
    }))
    .filter((option) => option.id !== '');
}

function toPosition(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Wiersze `get_public_job_screening_questions` / `job_screening_questions` → pytania. */
export function parseScreeningQuestions(rows: unknown): ScreeningQuestion[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => asRecord(row))
    .filter((row) => typeof row['id'] === 'string' && isScreeningQuestionType(row['type']))
    .map((row) => ({
      id: row['id'] as string,
      position: toPosition(row['position']),
      type: row['type'] as ScreeningQuestionType,
      required: row['required'] === true,
      prompt: toLocalizedText(row['prompt']),
      options: toOptions(row['options']),
    }))
    .sort((a, b) => a.position - b.position);
}

/** Wiersze `application_screening_answers` → odpowiedzi w kolejności pytań. */
export function parseScreeningAnswers(rows: unknown): ScreeningAnswer[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => asRecord(row))
    .filter((row) => isScreeningQuestionType(row['type']))
    .map((row) => ({
      position: toPosition(row['position']),
      type: row['type'] as ScreeningQuestionType,
      required: row['required'] === true,
      prompt: toLocalizedText(row['prompt']),
      options: toOptions(row['options']),
      answerBoolean: typeof row['answer_boolean'] === 'boolean' ? row['answer_boolean'] : null,
      answerDate: typeof row['answer_date'] === 'string' ? row['answer_date'].slice(0, 10) : null,
      answerText: typeof row['answer_text'] === 'string' ? row['answer_text'] : null,
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * Tekst w języku widza; brak tłumaczenia → język treści oferty → język domyślny → pierwszy
 * dostępny. Pytanie zawsze ma tekst w języku oferty (wymóg bazy).
 */
export function localizedText(text: LocalizedText, locale: string, contentLocale?: string): string {
  const candidates = [locale, contentLocale, routing.defaultLocale];
  for (const candidate of candidates) {
    if (candidate && isLocale(candidate)) {
      const value = text[candidate]?.trim();
      if (value) return value;
    }
  }
  return Object.values(text).find((value) => value?.trim())?.trim() ?? '';
}

/** Mapa po przycięciu i bez pustych wartości (payload RPC). */
export function cleanLocalizedText(text: LocalizedText): LocalizedText {
  const out: LocalizedText = {};
  for (const locale of routing.locales) {
    const value = text[locale]?.trim();
    if (value) out[locale] = value;
  }
  return out;
}

/** Brak odpowiedzi: brak wartości albo pusty tekst (tak samo liczy baza). */
export function isScreeningAnswerMissing(value: ScreeningAnswerValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}
