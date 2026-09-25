import 'server-only';

import type { AiFeatureId } from '@/lib/ai/inventory';

/**
 * Punkt wpięcia globalnego budżetu AI (#36, gałąź `claude/ai-budget`). Asystent (#37) woła
 * `reserve` PRZED wywołaniem modelu i `settle` PO nim (same liczby tokenów — bez treści).
 *
 * Do czasu scalenia #36 działa domyślna bramka „bez budżetu” (zawsze zgoda, `settle` no-op);
 * koszty ogranicza limit per firma w akcji (fail-closed). #36 podmienia implementację przez
 * `setAiBudgetGate` (albo zastępuje ten plik adapterem do własnego modułu) — kontrakt poniżej
 * jest jedynym, na którym polega asystent.
 */

export interface AiBudgetRequest {
  feature: AiFeatureId;
  /** Aktywna firma (`null` w trybie demo z atrapą — atrapa nic nie kosztuje). */
  companyId: string | null;
  model: string;
}

export interface AiBudgetSpend extends AiBudgetRequest {
  inputTokens: number;
  outputTokens: number;
}

export interface AiBudgetGate {
  /** `false` = budżet wyczerpany → brak wywołania modelu (kod `AI_BUDGET_EXCEEDED`). */
  reserve(request: AiBudgetRequest): Promise<boolean>;
  /** Rozliczenie po wywołaniu. Błąd rozliczenia nie może zepsuć odpowiedzi dla użytkownika. */
  settle(spend: AiBudgetSpend): Promise<void>;
}

const NO_BUDGET: AiBudgetGate = {
  reserve: async () => true,
  settle: async () => undefined,
};

let gate: AiBudgetGate = NO_BUDGET;

export function aiBudgetGate(): AiBudgetGate {
  return gate;
}

/** Podmiana bramki (#36; testy). `null` = powrót do domyślnej. */
export function setAiBudgetGate(next: AiBudgetGate | null): void {
  gate = next ?? NO_BUDGET;
}
