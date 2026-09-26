/**
 * Cennik modeli dla budżetu AI (#36) — czysty moduł, bez I/O.
 *
 * Dostawca: OpenAI (decyzja właściciela 2026-09-26 — wyłącznie „GPT-6 Luna”). Stawki: USD za
 * 1 mln tokenów, tier Standard, wg https://developers.openai.com/api/docs/pricing (stan
 * 2026-09-26; `gpt-6-luna` potwierdzony też na stronie modelu). Koszty liczymy w mikro-USD
 * (1 USD = 1 000 000), jak kolumny `ai_usage_ledger` (0120). Nieznany model = najdroższa
 * stawka z tabeli — budżet nigdy nie zaniża kosztu. Atrapa `fixture` = 0.
 *
 * Długi kontekst: cennik OpenAI ma osobne stawki „long context”, ale nie podaje progu.
 * TODO(właściciel): potwierdzić próg w dokumentacji OpenAI — przyjmujemy 272 000 tokenów
 * wejścia (źródła wtórne), a powyżej niego cały request po stawkach długiego kontekstu.
 * Nasze wejścia są ucinane daleko poniżej progu (tekst strony ≤ 40 000 znaków).
 *
 * Zmiana cennika dostawcy = zmiana tej tabeli (test `ai-budget.test.ts` pilnuje, że każdy
 * domyślny model funkcji ma stawkę).
 */

export interface ModelRate {
  inputPerMTok: number;
  /** Odczyt z cache promptu (`input_tokens_details.cached_tokens`). */
  cachedInputPerMTok: number;
  /** Zapis do cache promptu (`input_tokens_details.cache_write_tokens`). */
  cacheWritePerMTok: number;
  outputPerMTok: number;
}

export interface ModelPricing {
  short: ModelRate;
  long: ModelRate;
}

/** Próg długiego kontekstu (tokeny wejścia) — do potwierdzenia, patrz nagłówek. */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gpt-6-luna': {
    short: { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, cacheWritePerMTok: 0.125, outputPerMTok: 0.5 },
    long: { inputPerMTok: 0.2, cachedInputPerMTok: 0.02, cacheWritePerMTok: 0.25, outputPerMTok: 0.75 },
  },
  // Droższe modele tej rodziny — tylko po to, by błędne `AI_MODEL` nie zaniżało kosztu.
  'gpt-6-sol': {
    short: { inputPerMTok: 2, cachedInputPerMTok: 0.2, cacheWritePerMTok: 2.5, outputPerMTok: 10 },
    long: { inputPerMTok: 4, cachedInputPerMTok: 0.4, cacheWritePerMTok: 5, outputPerMTok: 15 },
  },
  'gpt-6-astra': {
    short: { inputPerMTok: 10, cachedInputPerMTok: 1, cacheWritePerMTok: 12.5, outputPerMTok: 50 },
    long: { inputPerMTok: 20, cachedInputPerMTok: 2, cacheWritePerMTok: 25, outputPerMTok: 75 },
  },
};

/** Model atrapy (E2E/lokalnie) — bez kosztu, ale przez ten sam przepływ budżetu. */
export const FIXTURE_MODEL = 'fixture';

const ZERO_RATE: ModelRate = { inputPerMTok: 0, cachedInputPerMTok: 0, cacheWritePerMTok: 0, outputPerMTok: 0 };

function maxRate(rates: ModelRate[]): ModelRate {
  return rates.reduce(
    (max, rate) => ({
      inputPerMTok: Math.max(max.inputPerMTok, rate.inputPerMTok),
      cachedInputPerMTok: Math.max(max.cachedInputPerMTok, rate.cachedInputPerMTok),
      cacheWritePerMTok: Math.max(max.cacheWritePerMTok, rate.cacheWritePerMTok),
      outputPerMTok: Math.max(max.outputPerMTok, rate.outputPerMTok),
    }),
    ZERO_RATE,
  );
}

/** Stawka dla nieznanego modelu: maksimum każdej składowej z całej tabeli (także długi kontekst). */
const MAX_RATE: ModelRate = maxRate(Object.values(MODEL_PRICING).flatMap((p) => [p.short, p.long]));

/**
 * Stawka modelu dla danej liczby tokenów wejścia. Snapshot z datą (`gpt-6-luna-2026-09-22`)
 * korzysta ze stawki modelu bazowego.
 */
export function modelRate(model: string, totalInputTokens = 0): ModelRate {
  if (model === FIXTURE_MODEL) return ZERO_RATE;
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!pricing) return MAX_RATE;
  return totalInputTokens > LONG_CONTEXT_THRESHOLD_TOKENS ? pricing.long : pricing.short;
}

/**
 * Zużycie tokenów zgłoszone przez dostawcę, rozłożone na składowe cennika. Mapowanie
 * `usage` z Responses API OpenAI: {@link usageFromOpenAi} (`src/lib/ai/openai.ts`).
 */
export interface AiTokenUsage {
  /** Tokeny wejścia po pełnej stawce (bez odczytów i zapisów cache). */
  inputTokens: number;
  outputTokens: number;
  /** Zapis do cache promptu — stawka `cacheWritePerMTok`. */
  cacheCreationInputTokens?: number;
  /** Odczyt z cache promptu — stawka `cachedInputPerMTok`. */
  cacheReadInputTokens?: number;
}

function tokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Wszystkie tokeny wejścia (także cache) — decydują o stawce długiego kontekstu. */
export function totalInputTokens(usage: AiTokenUsage): number {
  return tokens(usage.inputTokens) + tokens(usage.cacheCreationInputTokens) + tokens(usage.cacheReadInputTokens);
}

/** Koszt wywołania w mikro-USD (zaokrąglony w górę). */
export function costMicroUsd(model: string, usage: AiTokenUsage): number {
  const rate = modelRate(model, totalInputTokens(usage));
  // Stawka za 1 mln tokenów w USD = mikro-USD za token.
  const micro =
    tokens(usage.inputTokens) * rate.inputPerMTok +
    tokens(usage.cacheCreationInputTokens) * rate.cacheWritePerMTok +
    tokens(usage.cacheReadInputTokens) * rate.cachedInputPerMTok +
    tokens(usage.outputTokens) * rate.outputPerMTok;
  return Math.ceil(micro);
}

/**
 * Szacunek przed wywołaniem (kwota rezerwacji): górna granica wejścia i pełne
 * `max_output_tokens` wyjścia (u OpenAI obejmuje też tokeny rozumowania). Minimum 1 mikro-USD —
 * rezerwacja zerowa nie chroniłaby budżetu (baza ją odrzuca). Wejście liczone zachowawczo po
 * stawce zapisu do cache, jeśli jest wyższa niż zwykła.
 */
export function estimateMicroUsd(model: string, estimate: { inputTokens: number; maxOutputTokens: number }): number {
  const rate = modelRate(model, estimate.inputTokens);
  const inputRate = Math.max(rate.inputPerMTok, rate.cacheWritePerMTok);
  const micro = tokens(estimate.inputTokens) * inputRate + tokens(estimate.maxOutputTokens) * rate.outputPerMTok;
  return Math.max(1, Math.ceil(micro));
}

/**
 * Zachowawcza górna granica tokenów tekstu: 1 token na 2 znaki (tokenizery dają zwykle 3–4
 * znaki na token; dla tekstów z cyframi i znakami spoza ASCII mniej).
 */
export function textTokenUpperBound(text: string): number {
  return Math.ceil(text.length / 2);
}

/**
 * Górna granica tokenów obrazu (zrzut ogłoszenia, `detail: 'high'`). Przewodnik „Images and
 * vision” OpenAI podaje dla GPT-6 (`gpt-6-astra`) budżet 2 500 łatek 32 px × mnożnik 1,2
 * = 3 000 tokenów; `gpt-6-luna` nie ma tam osobnego wiersza — przyjmujemy 4× zapas.
 * Rozliczenie i tak bierze rzeczywiste `usage` z odpowiedzi.
 */
export const IMAGE_TOKEN_UPPER_BOUND = 12_000;
