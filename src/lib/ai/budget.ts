import 'server-only';

import { AiBudgetError } from '@/lib/ai/budget-error';
import type { AiFeatureId } from '@/lib/ai/inventory';
import { costMicroUsd, type AiTokenUsage } from '@/lib/ai/pricing';
import type { AiUsageOutcome } from '@/lib/ai/usage-log';
import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

/**
 * Globalny budżet kosztów AI (#36, migracja 0120).
 *
 * Każde płatne wywołanie modelu przechodzi przez {@link withAiBudget}:
 *   1. rezerwacja szacunku PRZED wywołaniem API (`ai_budget_reserve`, blokada w bazie —
 *      równoległe żądania nie przekroczą limitu razem);
 *   2. wywołanie; dostawca zgłasza zużycie przez `reportUsage` (także przy odmowie modelu —
 *      tokeny są wtedy naliczone);
 *   3. rozliczenie (`ai_budget_settle`) rzeczywistym kosztem; bez zgłoszonego zużycia —
 *      kwotą rezerwacji.
 *
 * Fail-closed: przekroczony limit, brak limitu, brak bazy zadań serwerowych albo błąd
 * rezerwacji = {@link AiBudgetError} i BRAK wywołania API. Błąd rozliczenia nie zmienia
 * wyniku dla użytkownika — rezerwacja zostaje policzona w całości (zachowawczo).
 *
 * Rejestr nie zawiera treści ani identyfikatorów osób/firm — tylko funkcję, model, wynik,
 * tokeny i koszt (jak log użycia `src/lib/ai/usage-log.ts`).
 *
 * Hook dla kolejnych funkcji (np. tłumaczenia #514): owiń wywołanie dostawcy w
 * `withAiBudget({ feature: 'content_translation', model, estimateMicroUsd }, …)` i zgłoś
 * `usage` z odpowiedzi; `AiBudgetError` traktuj jak błąd przejściowy (ponów później).
 */

export { AiBudgetError, type AiBudgetFailure } from '@/lib/ai/budget-error';

export interface AiBudgetStore {
  /** Zwraca identyfikator rezerwacji; rzuca `AiBudgetError`. */
  reserve(feature: AiFeatureId, model: string, estimateMicroUsd: number): Promise<string>;
  settle(
    id: string,
    settlement: { outcome: AiUsageOutcome; usage: AiTokenUsage | null; costMicroUsd: number | null },
  ): Promise<void>;
}

/** Rezerwacja/rozliczenie w PostgreSQL (pula service-role). */
export const databaseBudgetStore: AiBudgetStore = {
  async reserve(feature, model, estimate) {
    if (!isServiceDatabaseConfigured()) throw new AiBudgetError('unavailable');
    try {
      const id = await withServiceRole((tx) =>
        rpc<string>(tx, 'ai_budget_reserve', {
          p_feature: feature,
          p_model: model,
          p_estimate_micro_usd: estimate,
        }),
      );
      if (typeof id !== 'string') throw new Error('ai_budget_reserve: brak identyfikatora');
      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('AI_BUDGET_EXCEEDED')) throw new AiBudgetError('exceeded');
      captureError(error, { area: 'ai.budget', step: 'reserve' });
      throw new AiBudgetError('unavailable');
    }
  },
  async settle(id, { outcome, usage, costMicroUsd: cost }) {
    await withServiceRole((tx) =>
      rpc(tx, 'ai_budget_settle', {
        p_id: id,
        p_outcome: outcome,
        p_input_tokens: usage ? usage.inputTokens + (usage.cacheCreationInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) : null,
        p_output_tokens: usage ? usage.outputTokens : null,
        p_cost_micro_usd: cost,
      }),
    );
  },
};

export interface AiBudgetRequest {
  feature: AiFeatureId;
  model: string;
  /** Kwota rezerwacji (mikro-USD) — górna granica kosztu wywołania (`estimateMicroUsd`). */
  estimateMicroUsd: number;
}

/** Wywołujący zgłasza zużycie z odpowiedzi dostawcy (może zgłosić raz; kolejne nadpisują). */
export type ReportUsage = (usage: AiTokenUsage) => void;

export async function withAiBudget<T>(
  request: AiBudgetRequest,
  run: (reportUsage: ReportUsage) => Promise<T>,
  classify: (result: { ok: true; value: T } | { ok: false; error: unknown }) => AiUsageOutcome,
  store: AiBudgetStore = databaseBudgetStore,
): Promise<T> {
  const estimate = Math.max(1, Math.ceil(request.estimateMicroUsd));
  const reservation = await store.reserve(request.feature, request.model, estimate);

  let usage: AiTokenUsage | null = null;
  const settle = async (outcome: AiUsageOutcome) => {
    try {
      await store.settle(reservation, {
        outcome,
        usage,
        costMicroUsd: usage ? costMicroUsd(request.model, usage) : null,
      });
    } catch (error) {
      // Rezerwacja zostaje policzona w całości — budżet nie jest zaniżany.
      captureError(error, { area: 'ai.budget', step: 'settle' });
    }
  };

  try {
    const value = await run((reported) => {
      usage = reported;
    });
    await settle(classify({ ok: true, value }));
    return value;
  } catch (error) {
    await settle(classify({ ok: false, error }));
    throw error;
  }
}
