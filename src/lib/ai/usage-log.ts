import 'server-only';

import { AI_FEATURE_IDS, type AiFeatureId } from '@/lib/ai/inventory';

/**
 * Log użycia funkcji AI (#489) — jeden wiersz JSON na wywołanie modelu, BEZ treści i PII.
 *
 * Wiersz ma wyłącznie pola z listy {@link AI_USAGE_FIELDS}: funkcja z inwentarza, wynik
 * (enum), rodzaj wejścia (enum), model (walidowany identyfikator), czas trwania i znacznik
 * czasu. Nie ma w nim treści ogłoszenia, promptu, odpowiedzi modelu, adresu URL, nazwy pliku,
 * identyfikatora użytkownika ani firmy. Pola spoza listy są odrzucane także wtedy, gdy ktoś
 * poda je z pominięciem typów — builder kopiuje tylko znane klucze.
 *
 * Cel: odpowiedź na pytania „czy i jak często funkcja AI działa, z jakim wynikiem, na jakim
 * modelu” (inwentarz, DPIA, koszty) bez tworzenia nowego zbioru danych osobowych.
 */

export const AI_USAGE_OUTCOMES = ['ok', 'refused', 'failed', 'rate_limited', 'rejected_input'] as const;
export type AiUsageOutcome = (typeof AI_USAGE_OUTCOMES)[number];

export const AI_USAGE_INPUT_KINDS = ['image', 'text', 'url'] as const;
export type AiUsageInputKind = (typeof AI_USAGE_INPUT_KINDS)[number];

export interface AiUsageEvent {
  feature: AiFeatureId;
  outcome: AiUsageOutcome;
  inputKind: AiUsageInputKind;
  model: string;
  durationMs: number;
}

export interface AiUsageLine extends AiUsageEvent {
  type: 'ai_usage';
  at: string;
}

/** Jedyne klucze, które mogą trafić do logu. */
export const AI_USAGE_FIELDS = ['type', 'at', 'feature', 'outcome', 'inputKind', 'model', 'durationMs'] as const;

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Buduje wiersz logu; nieznane/niepoprawne wartości są zastępowane, nigdy przepisywane. */
export function buildAiUsageLine(event: AiUsageEvent, now: Date = new Date()): AiUsageLine | null {
  if (!(AI_FEATURE_IDS as readonly string[]).includes(event.feature)) return null;
  const duration = Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : 0;
  return {
    type: 'ai_usage',
    at: now.toISOString(),
    feature: event.feature,
    outcome: oneOf(AI_USAGE_OUTCOMES, event.outcome, 'failed'),
    inputKind: oneOf(AI_USAGE_INPUT_KINDS, event.inputKind, 'text'),
    model: typeof event.model === 'string' && MODEL_ID.test(event.model) ? event.model : 'unknown',
    durationMs: duration,
  };
}

export type AiUsageSink = (line: AiUsageLine) => void;

const defaultSink: AiUsageSink = (line) => {
  console.info(JSON.stringify(line));
};

/** Zapisuje wiersz użycia. Nie rzuca — log nie może zepsuć funkcji. */
export function recordAiUsage(event: AiUsageEvent, sink: AiUsageSink = defaultSink): void {
  try {
    const line = buildAiUsageLine(event);
    if (line) sink(line);
  } catch {
    // Brak logu nie blokuje użytkownika.
  }
}

/** Mierzy czas `run`, loguje wynik (`classify` mapuje wyjątek/wynik na enum) i zwraca wynik. */
export async function withAiUsageLog<T>(
  meta: { feature: AiFeatureId; inputKind: AiUsageInputKind; model: string },
  run: () => Promise<T>,
  classify: (result: { ok: true; value: T } | { ok: false; error: unknown }) => AiUsageOutcome,
  sink?: AiUsageSink,
): Promise<T> {
  const started = Date.now();
  try {
    const value = await run();
    recordAiUsage({ ...meta, outcome: classify({ ok: true, value }), durationMs: Date.now() - started }, sink);
    return value;
  } catch (error) {
    recordAiUsage({ ...meta, outcome: classify({ ok: false, error }), durationMs: Date.now() - started }, sink);
    throw error;
  }
}
