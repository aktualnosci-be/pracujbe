/**
 * Cennik modeli dla budżetu AI (#36) — czysty moduł, bez I/O.
 *
 * Stawki: USD za 1 mln tokenów wg cennika pierwszej strony Anthropic (stan 2026-09). Koszty
 * liczymy w mikro-USD (1 USD = 1 000 000), jak kolumny `ai_usage_ledger` (0114). Nieznany
 * model = najdroższa stawka z tabeli — budżet nigdy nie zaniża kosztu. Atrapa `fixture` = 0.
 *
 * Zmiana cennika dostawcy = zmiana tej tabeli (test `ai-budget.test.ts` pilnuje, że każdy
 * domyślny model funkcji ma stawkę).
 */

export interface ModelRate {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-6': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Model atrapy (E2E/lokalnie) — bez kosztu, ale przez ten sam przepływ budżetu. */
export const FIXTURE_MODEL = 'fixture';

const MAX_RATE: ModelRate = Object.values(MODEL_RATES).reduce(
  (max, rate) => ({
    inputPerMTok: Math.max(max.inputPerMTok, rate.inputPerMTok),
    outputPerMTok: Math.max(max.outputPerMTok, rate.outputPerMTok),
  }),
  { inputPerMTok: 0, outputPerMTok: 0 },
);

export function modelRate(model: string): ModelRate {
  if (model === FIXTURE_MODEL) return { inputPerMTok: 0, outputPerMTok: 0 };
  return MODEL_RATES[model] ?? MAX_RATE;
}

/** Zużycie tokenów zgłoszone przez dostawcę (pola `usage` odpowiedzi Messages API). */
export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Zapis do cache promptu — 1,25 × stawka wejścia. */
  cacheCreationInputTokens?: number;
  /** Odczyt z cache promptu — 0,1 × stawka wejścia. */
  cacheReadInputTokens?: number;
}

function tokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Koszt wywołania w mikro-USD (zaokrąglony w górę). */
export function costMicroUsd(model: string, usage: AiTokenUsage): number {
  const rate = modelRate(model);
  // Stawka za 1 mln tokenów w USD = mikro-USD za token.
  const micro =
    tokens(usage.inputTokens) * rate.inputPerMTok +
    tokens(usage.cacheCreationInputTokens) * rate.inputPerMTok * 1.25 +
    tokens(usage.cacheReadInputTokens) * rate.inputPerMTok * 0.1 +
    tokens(usage.outputTokens) * rate.outputPerMTok;
  return Math.ceil(micro);
}

/**
 * Szacunek przed wywołaniem (kwota rezerwacji): górna granica wejścia i pełne `max_tokens`
 * wyjścia. Minimum 1 mikro-USD — rezerwacja zerowa nie chroniłaby budżetu (baza ją odrzuca).
 */
export function estimateMicroUsd(model: string, estimate: { inputTokens: number; maxOutputTokens: number }): number {
  return Math.max(1, costMicroUsd(model, { inputTokens: estimate.inputTokens, outputTokens: estimate.maxOutputTokens }));
}

/**
 * Zachowawcza górna granica tokenów tekstu: 1 token na 2 znaki (tokenizery Claude dają
 * zwykle 3–4 znaki na token; dla tekstów z cyframi i znakami spoza ASCII mniej).
 */
export function textTokenUpperBound(text: string): number {
  return Math.ceil(text.length / 2);
}

/**
 * Górna granica tokenów obrazu. Obraz jest skalowany przez API; nawet w wysokiej
 * rozdzielczości nie przekracza kilku tysięcy tokenów — przyjmujemy z zapasem 6000.
 */
export const IMAGE_TOKEN_UPPER_BOUND = 6000;
