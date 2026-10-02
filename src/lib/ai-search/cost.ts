import { JOB_SEARCH_ASSIST_MAX_TOKENS, SEARCH_ASSIST_SYSTEM_PROMPT } from '@/lib/ai-search/interpret';
import { estimateMicroUsd, textTokenUpperBound } from '@/lib/ai/pricing';
import { SEARCH_ASSIST_JSON_SCHEMA, SEARCH_ASSIST_LIMITS } from '@/lib/ai-search/schema';

export { JOB_SEARCH_ASSIST_MAX_TOKENS };

const PROMPT_OVERHEAD_TOKENS =
  textTokenUpperBound(SEARCH_ASSIST_SYSTEM_PROMPT) + textTokenUpperBound(JSON.stringify(SEARCH_ASSIST_JSON_SCHEMA)) + 500;

/**
 * Górna granica kosztu jednego wywołania (mikro-USD) — kwota rezerwacji w globalnym budżecie AI
 * (#36): prompt + schemat + najdłuższy dopuszczalny tekst + pełne `max_output_tokens` wyjścia.
 */
export function estimateJobSearchAssistCost(model: string): number {
  return estimateMicroUsd(model, {
    inputTokens: PROMPT_OVERHEAD_TOKENS + textTokenUpperBound('x'.repeat(SEARCH_ASSIST_LIMITS.textMax)) * 2,
    maxOutputTokens: JOB_SEARCH_ASSIST_MAX_TOKENS,
  });
}
