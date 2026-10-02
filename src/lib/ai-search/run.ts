import 'server-only';

import type { ErrorCode } from '@/lib/errors';
import { AiBudgetError, withAiBudget, type AiBudgetStore } from '@/lib/ai/budget';
import type { AiTokenUsage } from '@/lib/ai/pricing';
import { withAiUsageLog, type AiUsageOutcome, type AiUsageSink } from '@/lib/ai/usage-log';
import { estimateJobSearchAssistCost } from '@/lib/ai-search/cost';
import { detectSearchInjection, mapSearchResponse, redactSearchText, type MappedSearch } from '@/lib/ai-search/guard';
import { SearchInterpreterError, type SearchInterpreter } from '@/lib/ai-search/interpret';
import { searchAssistResponseSchema, type SearchAssistRequest } from '@/lib/ai-search/schema';

/**
 * Rdzeń wyszukiwania opisem (#711) bez limitów (robi je akcja). Dostawca i magazyn budżetu są
 * wstrzykiwane — testy nie wykonują żadnych wywołań sieci ani API.
 *
 * Kolejność: kontrola wejścia (polecenia dla AI → bez modelu) → redakcja danych osobowych →
 * budżet (#36, rezerwacja PRZED API) → model → walidacja kształtu → bramki słowników
 * (`guard.ts`). Wynik to wyłącznie PROPOZYCJA filtrów — nic nie jest zapisywane ani stosowane.
 */

export type RunSearchAssistResult = { ok: true; mapped: MappedSearch } | { ok: false; error: ErrorCode };

export interface RunSearchAssistDeps {
  interpreter: SearchInterpreter;
  model: string;
  /** `null` = bez budżetu (wyłącznie atrapa bez bazy zadań serwerowych — demo/E2E). */
  budgetStore: AiBudgetStore | null;
  sink?: AiUsageSink;
}

export function classifySearchAssist(result: { ok: true } | { ok: false; error: unknown }): AiUsageOutcome {
  if (result.ok) return 'ok';
  if (result.error instanceof SearchInterpreterError) {
    if (result.error.reason === 'refused') return 'refused';
    if (result.error.reason === 'rateLimited') return 'rate_limited';
  }
  return 'failed';
}

/** Kontrola wejścia bez sieci (przed limitami — zły wniosek nie zużywa limitu). */
export function precheckSearchAssist(request: SearchAssistRequest): { ok: true } | { ok: false; error: ErrorCode } {
  if (detectSearchInjection(request.text)) return { ok: false, error: 'JOB_SEARCH_ASSIST_SUSPICIOUS' };
  return { ok: true };
}

export async function runJobSearchAssist(
  request: SearchAssistRequest,
  deps: RunSearchAssistDeps,
): Promise<RunSearchAssistResult> {
  const pre = precheckSearchAssist(request);
  if (!pre.ok) return pre;

  const sent: SearchAssistRequest = { ...request, text: redactSearchText(request.text) };
  const logged = (onUsage?: (usage: AiTokenUsage) => void) =>
    withAiUsageLog(
      { feature: 'job_search_filters', inputKind: 'text', model: deps.model },
      () => deps.interpreter.interpret(sent, { onUsage }),
      classifySearchAssist,
      deps.sink,
    );

  let raw: unknown;
  try {
    raw = deps.budgetStore
      ? await withAiBudget(
          { feature: 'job_search_filters', model: deps.model, estimateMicroUsd: estimateJobSearchAssistCost(deps.model) },
          (reportUsage) => logged(reportUsage),
          classifySearchAssist,
          deps.budgetStore,
        )
      : await logged();
  } catch (e) {
    if (e instanceof AiBudgetError) return { ok: false, error: 'AI_BUDGET_EXCEEDED' };
    if (e instanceof SearchInterpreterError && e.reason === 'rateLimited') return { ok: false, error: 'RATE_LIMITED' };
    return { ok: false, error: 'JOB_SEARCH_ASSIST_FAILED' };
  }

  const parsed = searchAssistResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'JOB_SEARCH_ASSIST_FAILED' };
  // Model zgłosił polecenie dla AI — żadnej propozycji.
  if (parsed.data.suspiciousInstructions) return { ok: false, error: 'JOB_SEARCH_ASSIST_SUSPICIOUS' };

  const mapped = mapSearchResponse(request, sent.text, parsed.data);
  if (Object.keys(mapped.params).length === 0 && mapped.places.length === 0) {
    return { ok: false, error: 'JOB_SEARCH_ASSIST_NO_FILTERS' };
  }
  return { ok: true, mapped };
}
