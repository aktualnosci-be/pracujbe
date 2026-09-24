import 'server-only';

import { ExtractorError, type JobExtractor } from '@/lib/ai-import/extract';
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
    extract: (input) =>
      withAiUsageLog(
        { feature: 'job_listing_import', inputKind: input.kind, model },
        () => extractor.extract(input),
        classifyExtraction,
        sink,
      ),
  };
}
