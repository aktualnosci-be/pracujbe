import 'server-only';

import {
  EXTRACTION_SYSTEM_PROMPT,
  ExtractorError,
  JOB_EXTRACTION_MAX_TOKENS,
  type ExtractionInput,
  type JobExtractor,
} from '@/lib/ai-import/extract';
import { JOB_EXTRACTION_JSON_SCHEMA } from '@/lib/ai-import/schema';
import { withAiBudget, type AiBudgetStore } from '@/lib/ai/budget';
import { estimateMicroUsd, IMAGE_TOKEN_UPPER_BOUND, textTokenUpperBound } from '@/lib/ai/pricing';
import { withAiUsageLog, type AiUsageOutcome, type AiUsageSink } from '@/lib/ai/usage-log';

/**
 * Log użycia importu ogłoszenia (#465, #489): owija ekstraktor tak, by każde wywołanie modelu
 * dało jeden wiersz `ai_usage` (wynik, rodzaj wejścia, model, czas) — bez treści ogłoszenia,
 * odpowiedzi modelu, adresu URL i identyfikatorów użytkownika/firmy.
 */
export function classifyExtraction(result: { ok: true } | { ok: false; error: unknown }): AiUsageOutcome {
  if (result.ok) return 'ok';
  if (result.error instanceof ExtractorError) {
    if (result.error.reason === 'refused') return 'refused';
    if (result.error.reason === 'rateLimited') return 'rate_limited';
  }
  return 'failed';
}

export function withJobImportUsageLog(extractor: JobExtractor, model: string, sink?: AiUsageSink): JobExtractor {
  return {
    extract: (input, hooks) =>
      withAiUsageLog(
        { feature: 'job_listing_import', inputKind: input.kind, model },
        () => extractor.extract(input, hooks),
        classifyExtraction,
        sink,
      ),
  };
}

/** Stała część promptu (instrukcje + schemat odpowiedzi) — liczona raz. */
const PROMPT_OVERHEAD_TOKENS =
  textTokenUpperBound(EXTRACTION_SYSTEM_PROMPT) + textTokenUpperBound(JSON.stringify(JOB_EXTRACTION_JSON_SCHEMA)) + 500;

/** Górna granica kosztu jednej ekstrakcji (mikro-USD) — kwota rezerwacji budżetu (#36). */
export function estimateJobImportCost(input: ExtractionInput, model: string): number {
  const material = input.kind === 'image' ? IMAGE_TOKEN_UPPER_BOUND : textTokenUpperBound(input.text);
  return estimateMicroUsd(model, {
    inputTokens: PROMPT_OVERHEAD_TOKENS + material,
    maxOutputTokens: JOB_EXTRACTION_MAX_TOKENS,
  });
}

/**
 * Budżet importu (#36): rezerwacja przed wywołaniem modelu, rozliczenie tokenami
 * z odpowiedzi. Przekroczony/niedostępny budżet = `AiBudgetError`, ekstraktor nie jest wołany.
 */
export function withJobImportBudget(extractor: JobExtractor, model: string, store?: AiBudgetStore): JobExtractor {
  return {
    extract: (input, hooks) =>
      withAiBudget(
        { feature: 'job_listing_import', model, estimateMicroUsd: estimateJobImportCost(input, model) },
        (reportUsage) =>
          extractor.extract(input, {
            onUsage: (usage) => {
              reportUsage(usage);
              hooks?.onUsage?.(usage);
            },
          }),
        classifyExtraction,
        store,
      ),
  };
}
