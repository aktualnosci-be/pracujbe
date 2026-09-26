import { ASSIST_SYSTEM_PROMPT, JOB_ASSIST_MAX_TOKENS } from '@/lib/ai-assist/assist';
import { ASSIST_JSON_SCHEMA, type AssistRequest } from '@/lib/ai-assist/schema';
import { estimateMicroUsd, textTokenUpperBound } from '@/lib/ai/pricing';

export { JOB_ASSIST_MAX_TOKENS };

const PROMPT_OVERHEAD_TOKENS =
  textTokenUpperBound(ASSIST_SYSTEM_PROMPT) + textTokenUpperBound(JSON.stringify(ASSIST_JSON_SCHEMA)) + 500;

/**
 * Górna granica kosztu jednego wywołania asystenta (mikro-USD) — kwota rezerwacji w globalnym
 * budżecie AI (#36): prompt + schemat + cała treść pól + pełne `max_tokens` wyjścia.
 */
export function estimateJobAssistCost(request: AssistRequest, model: string): number {
  return estimateMicroUsd(model, {
    inputTokens: PROMPT_OVERHEAD_TOKENS + textTokenUpperBound(JSON.stringify(request)),
    maxOutputTokens: JOB_ASSIST_MAX_TOKENS,
  });
}
