import 'server-only';

import { AiBudgetError } from '@/lib/ai/budget-error';
import { databaseBudgetStore, type AiBudgetStore } from '@/lib/ai/budget';
import type { AiFeatureId } from '@/lib/ai/inventory';
import { costMicroUsd, FIXTURE_MODEL } from '@/lib/ai/pricing';
import type { AiUsageOutcome } from '@/lib/ai/usage-log';
import { isServiceDatabaseConfigured } from '@/lib/db/portal';
import { captureError } from '@/lib/error-report';

/**
 * Bramka globalnego budżetu AI (#36, migracja 0120) dla asystenta treści oferty (#37).
 *
 * `reserve` PRZED wywołaniem modelu rezerwuje górną granicę kosztu w `ai_budget_reserve`
 * (wspólny limit doby i miesiąca dla wszystkich funkcji AI); `null` = budżet wyczerpany albo
 * nie da się go sprawdzić → brak wywołania modelu (`AI_BUDGET_EXCEEDED`, fail-closed).
 * Zwrócony bilet rozlicza TĘ rezerwację (`ai_budget_settle`) samymi liczbami tokenów; bez
 * zużycia (błąd wywołania) — pełną kwotą rezerwacji. `companyId` nie trafia do bazy.
 *
 * Atrapa (`fixture`) bez bazy zadań serwerowych (demo/E2E) nie kosztuje — bilet bez zapisu.
 */

export interface AiBudgetRequest {
  feature: AiFeatureId;
  /** Aktywna firma (`null` w trybie demo z atrapą). Nie jest zapisywana w rejestrze kosztów. */
  companyId: string | null;
  model: string;
  /** Kwota rezerwacji (mikro-USD) — górna granica kosztu (`estimateMicroUsd`). */
  estimateMicroUsd: number;
}

export interface AiBudgetSpend {
  inputTokens: number;
  outputTokens: number;
}

export interface AiBudgetTicket {
  /** `null` = zużycie nieznane (np. błąd wywołania) → rozliczenie kwotą rezerwacji. */
  settle(spend: AiBudgetSpend | null, outcome?: AiUsageOutcome): Promise<void>;
}

export interface AiBudgetGate {
  /** `null` = budżet wyczerpany/niedostępny → brak wywołania modelu (`AI_BUDGET_EXCEEDED`). */
  reserve(request: AiBudgetRequest): Promise<AiBudgetTicket | null>;
}

const FREE_TICKET: AiBudgetTicket = { settle: async () => undefined };

export function databaseBudgetGate(store: AiBudgetStore = databaseBudgetStore): AiBudgetGate {
  return {
    async reserve(request) {
      if (request.model === FIXTURE_MODEL && !isServiceDatabaseConfigured()) return FREE_TICKET;
      let id: string;
      try {
        id = await store.reserve(request.feature, request.model, Math.max(1, Math.ceil(request.estimateMicroUsd)));
      } catch (error) {
        if (!(error instanceof AiBudgetError)) captureError(error, { area: 'ai.budget', step: 'reserve' });
        return null;
      }
      let settled = false;
      return {
        async settle(spend, outcome = 'ok') {
          if (settled) return;
          settled = true;
          try {
            await store.settle(id, {
              outcome,
              usage: spend,
              costMicroUsd: spend ? costMicroUsd(request.model, spend) : null,
            });
          } catch (error) {
            // Rezerwacja zostaje policzona w całości — budżet nie jest zaniżany.
            captureError(error, { area: 'ai.budget', step: 'settle' });
          }
        },
      };
    },
  };
}

let gate: AiBudgetGate = databaseBudgetGate();

export function aiBudgetGate(): AiBudgetGate {
  return gate;
}

/** Podmiana bramki (testy). `null` = powrót do bramki bazy. */
export function setAiBudgetGate(next: AiBudgetGate | null): void {
  gate = next ?? databaseBudgetGate();
}
