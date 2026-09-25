import { CV_EXTRACTION_MAX_TOKENS, CV_EXTRACTION_SYSTEM_PROMPT, wrapCvText } from '@/lib/cv-import/extract';
import { CV_EXTRACTION_JSON_SCHEMA } from '@/lib/cv-import/proposals';
import { estimateMicroUsd, textTokenUpperBound } from '@/lib/ai/pricing';

const PROMPT_OVERHEAD_TOKENS =
  textTokenUpperBound(CV_EXTRACTION_SYSTEM_PROMPT) + textTokenUpperBound(JSON.stringify(CV_EXTRACTION_JSON_SCHEMA)) + 500;

/**
 * Górna granica kosztu jednego wywołania importu CV (mikro-USD) — kwota rezerwacji
 * w globalnym budżecie AI (#36): prompt + schemat + cały zminimalizowany tekst CV + pełne
 * `max_tokens` wyjścia.
 */
export function estimateCvImportCost(minimizedText: string, model: string): number {
  return estimateMicroUsd(model, {
    inputTokens: PROMPT_OVERHEAD_TOKENS + textTokenUpperBound(wrapCvText(minimizedText)),
    maxOutputTokens: CV_EXTRACTION_MAX_TOKENS,
  });
}
