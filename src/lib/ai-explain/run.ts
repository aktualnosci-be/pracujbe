import 'server-only';

import type { Locale } from '@/i18n/routing';
import { AiBudgetError, withAiBudget, type AiBudgetStore, type ReportUsage } from '@/lib/ai/budget';
import { AiProviderError } from '@/lib/ai/openai';
import { withAiUsageLog, type AiUsageOutcome, type AiUsageSink } from '@/lib/ai/usage-log';
import type { JobExplainer } from '@/lib/ai-explain/explain';
import { estimateJobExplainCost } from '@/lib/ai-explain/explain';
import { guardExplanation, sourcesContainInjection, type GuardedExplanation } from '@/lib/ai-explain/guard';
import { explainResponseSchema } from '@/lib/ai-explain/schema';
import type { ExplainSource } from '@/lib/ai-explain/sources';
import type { ErrorCode } from '@/lib/errors';

/**
 * Rdzeń „Wyjaśnij ofertę” (#773) bez odczytu oferty i limitów (robi je akcja). Dostawca i magazyn
 * budżetu są wstrzykiwane — testy nie wykonują wywołań sieci ani API.
 *
 * Kolejność: polecenie dla AI w treści oferty → brak wywołania; globalny budżet (#36,
 * `withAiBudget`: rezerwacja PRZED API, fail-closed) → model → parser → bramki faktów.
 * Wynik niczego nie zapisuje i nie zmienia oferty.
 */

export type RunExplainResult = ({ ok: true } & GuardedExplanation) | { ok: false; error: ErrorCode };

export interface RunExplainDeps {
  explainer: JobExplainer;
  model: string;
  /** `false` = bez rezerwacji budżetu (wyłącznie atrapa bez bazy zadań — demo/E2E). */
  budgeted: boolean;
  budgetStore?: AiBudgetStore;
  sink?: AiUsageSink;
}

export function classifyExplain(result: { ok: true } | { ok: false; error: unknown }): AiUsageOutcome {
  if (result.ok) return 'ok';
  if (result.error instanceof AiProviderError) {
    if (result.error.reason === 'refused') return 'refused';
    if (result.error.reason === 'rateLimited') return 'rate_limited';
  }
  return 'failed';
}

export async function runJobExplain(
  sources: readonly ExplainSource[],
  targetLocale: Locale,
  deps: RunExplainDeps,
): Promise<RunExplainResult> {
  if (sources.length === 0) return { ok: true, items: [], gaps: [], dropped: 0 };
  // Tekst skierowany do AI w treści oferty — nie wysyłamy go do modelu.
  if (sourcesContainInjection(sources)) return { ok: false, error: 'JOB_EXPLAIN_SUSPICIOUS' };

  const call = (onUsage?: ReportUsage) =>
    withAiUsageLog(
      { feature: 'job_offer_explain', inputKind: 'text', model: deps.model },
      () => deps.explainer.explain(sources, targetLocale, onUsage),
      classifyExplain,
      deps.sink,
    );

  let raw: unknown;
  try {
    raw = deps.budgeted
      ? await withAiBudget(
          {
            feature: 'job_offer_explain',
            model: deps.model,
            estimateMicroUsd: estimateJobExplainCost(sources, targetLocale, deps.model),
          },
          (reportUsage) => call(reportUsage),
          classifyExplain,
          deps.budgetStore,
        )
      : await call();
  } catch (e) {
    if (e instanceof AiBudgetError) return { ok: false, error: 'AI_BUDGET_EXCEEDED' };
    if (e instanceof AiProviderError && e.reason === 'rateLimited') return { ok: false, error: 'RATE_LIMITED' };
    return { ok: false, error: 'JOB_EXPLAIN_FAILED' };
  }

  const parsed = explainResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'JOB_EXPLAIN_FAILED' };
  if (parsed.data.suspiciousInstructions) return { ok: false, error: 'JOB_EXPLAIN_SUSPICIOUS' };
  return { ok: true, ...guardExplanation(parsed.data, sources, targetLocale) };
}
