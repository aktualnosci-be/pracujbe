import { estimateMicroUsd, textTokenUpperBound } from '@/lib/ai/pricing';
import { PROFILE_ASSIST_MAX_TOKENS, PROFILE_ASSIST_SYSTEM_PROMPT, wrapAnswers } from '@/lib/profile-assist/extract';
import { PROFILE_ASSIST_JSON_SCHEMA } from '@/lib/profile-assist/schema';

const PROMPT_OVERHEAD_TOKENS =
  textTokenUpperBound(PROFILE_ASSIST_SYSTEM_PROMPT) + textTokenUpperBound(JSON.stringify(PROFILE_ASSIST_JSON_SCHEMA)) + 500;

/**
 * Górna granica kosztu jednego wywołania asystenta profilu (mikro-USD) — kwota rezerwacji
 * w globalnym budżecie AI (#36): prompt + schemat + przygotowane odpowiedzi + pełne `max_tokens`.
 */
export function estimateProfileAssistCost(preparedText: string, model: string): number {
  return estimateMicroUsd(model, {
    inputTokens: PROMPT_OVERHEAD_TOKENS + textTokenUpperBound(wrapAnswers(preparedText)),
    maxOutputTokens: PROFILE_ASSIST_MAX_TOKENS,
  });
}
