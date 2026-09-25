import 'server-only';

import type { ErrorCode } from '@/lib/errors';
import { AssistorError, type JobAssistor } from '@/lib/ai-assist/assist';
import type { AssistDropped, AssistSuggestion } from '@/lib/ai-assist/fields';
import {
  detectInjection,
  guardSuggestions,
  hasAssistableContent,
  redactRequest,
  requestedFields,
} from '@/lib/ai-assist/guard';
import { assistResponseSchema, type AssistRequest } from '@/lib/ai-assist/schema';
import { withAiUsageLog, type AiUsageOutcome, type AiUsageSink } from '@/lib/ai/usage-log';

/**
 * Rdzeń asystenta redagowania oferty (#37) bez autoryzacji i limitów (robi je akcja).
 * Dostawca jest wstrzykiwany — testy nie wykonują żadnych wywołań sieci ani API.
 *
 * Wynik to wyłącznie PROPOZYCJE: nic nie jest zapisywane, formularz zmienia pracodawca.
 */

export type RunAssistResult =
  | { ok: true; suggestions: AssistSuggestion[]; dropped: AssistDropped[] }
  | { ok: false; error: ErrorCode };

export interface RunAssistDeps {
  assistor: JobAssistor;
  model: string;
  /** Rozliczenie tokenów (hook budżetu #36) — wołane po każdym udanym wywołaniu modelu. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => Promise<void>;
  sink?: AiUsageSink;
}

export function classifyAssist(result: { ok: true } | { ok: false; error: unknown }): AiUsageOutcome {
  if (result.ok) return 'ok';
  if (result.error instanceof AssistorError) {
    if (result.error.reason === 'refused') return 'refused';
    if (result.error.reason === 'rateLimited') return 'rate_limited';
  }
  return 'failed';
}

/** Kontrola wejścia bez sieci (przed sesją/limitami — zły wniosek nie zużywa limitu). */
export function precheckAssist(request: AssistRequest): { ok: true } | { ok: false; error: ErrorCode } {
  if (!hasAssistableContent(request) || requestedFields(request).length === 0) {
    return { ok: false, error: 'JOB_ASSIST_EMPTY' };
  }
  // Polecenie dla AI w tekście oferty — nie wysyłamy go do modelu.
  if (detectInjection(request)) return { ok: false, error: 'JOB_ASSIST_SUSPICIOUS' };
  return { ok: true };
}

export async function runJobAssist(request: AssistRequest, deps: RunAssistDeps): Promise<RunAssistResult> {
  const pre = precheckAssist(request);
  if (!pre.ok) return pre;

  const fields = requestedFields(request);
  const sent = redactRequest(request);

  let raw: unknown;
  try {
    const result = await withAiUsageLog(
      { feature: 'job_offer_assist', inputKind: 'text', model: deps.model },
      () => deps.assistor.suggest(sent, fields),
      classifyAssist,
      deps.sink,
    );
    raw = result.raw;
    try {
      await deps.onUsage?.(result.usage);
    } catch {
      // Błąd rozliczenia nie psuje odpowiedzi (budżet #36 loguje go po swojej stronie).
    }
  } catch (e) {
    if (e instanceof AssistorError && e.reason === 'rateLimited') return { ok: false, error: 'RATE_LIMITED' };
    return { ok: false, error: 'JOB_ASSIST_FAILED' };
  }

  const parsed = assistResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'JOB_ASSIST_FAILED' };
  // Model zgłosił polecenie dla AI — żadnej propozycji, pracodawca sprawdza tekst sam.
  if (parsed.data.suspiciousInstructions) return { ok: false, error: 'JOB_ASSIST_SUSPICIOUS' };
  if (parsed.data.wrongLanguage) return { ok: false, error: 'JOB_ASSIST_WRONG_LANGUAGE' };

  const { suggestions, dropped } = guardSuggestions(request, sent, parsed.data, fields);
  return { ok: true, suggestions, dropped };
}
