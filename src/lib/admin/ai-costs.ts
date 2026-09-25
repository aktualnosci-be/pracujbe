import { z } from 'zod/v3';

import { AI_FEATURE_IDS } from '@/lib/ai/inventory';

/**
 * Raport kosztów AI dla panelu admina (#36) — kształt odpowiedzi `ai_cost_report` (0114),
 * walidacja i pomocnicze obliczenia. Czysty moduł (bez I/O), testowany jednostkowo.
 * Kwoty w mikro-USD (1 USD = 1 000 000); raport nie zawiera identyfikatorów osób ani firm.
 */

const count = z.number().int().nonnegative();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const periodSchema = z.object({ spentMicroUsd: count, limitMicroUsd: count.nullable() });

export const aiBudgetStatusSchema = z.object({
  day: periodSchema,
  month: periodSchema,
  staleReservations: count,
});

export const aiCostReportSchema = z.object({
  status: aiBudgetStatusSchema,
  days: count,
  daily: z.array(
    z.object({
      day: ymd,
      feature: z.enum(AI_FEATURE_IDS),
      calls: count,
      ok: count,
      notOk: count,
      open: count,
      inputTokens: count,
      outputTokens: count,
      costMicroUsd: count,
    }),
  ),
  monthly: z.array(z.object({ month: ymd, calls: count, costMicroUsd: count })),
});

export type AiBudgetStatus = z.infer<typeof aiBudgetStatusSchema>;
export type AiCostReport = z.infer<typeof aiCostReportSchema>;

export function parseAiCostReport(raw: unknown): AiCostReport | null {
  const parsed = aiCostReportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseAiBudgetStatus(raw: unknown): AiBudgetStatus | null {
  const parsed = aiBudgetStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Limity startowe z migracji 0114 — także dla trybu DEMO. */
export const DEFAULT_AI_BUDGET_LIMITS = { dayMicroUsd: 10_000_000, monthMicroUsd: 100_000_000 } as const;

/** Próg ostrzeżenia (panel i /api/health/ops). */
export const AI_BUDGET_WARNING_RATIO = 0.8;

export type AiBudgetLevel = 'ok' | 'warning' | 'exhausted';

/**
 * Stan okresu: `exhausted` = brak limitu, limit 0 albo wydatek ≥ limit (nowe wywołania są
 * odrzucane przez bazę); `warning` = ≥ 80% limitu.
 */
export function aiBudgetLevel(period: { spentMicroUsd: number; limitMicroUsd: number | null }): AiBudgetLevel {
  const limit = period.limitMicroUsd;
  if (limit === null || limit <= 0 || period.spentMicroUsd >= limit) return 'exhausted';
  return period.spentMicroUsd >= limit * AI_BUDGET_WARNING_RATIO ? 'warning' : 'ok';
}

/** Procent wykorzystania (0–100+, zaokrąglony w dół); brak/zerowy limit = 100. */
export function aiBudgetPercent(period: { spentMicroUsd: number; limitMicroUsd: number | null }): number {
  const limit = period.limitMicroUsd;
  if (limit === null || limit <= 0) return 100;
  return Math.floor((period.spentMicroUsd / limit) * 100);
}

export function emptyAiCostReport(): AiCostReport {
  return {
    status: {
      day: { spentMicroUsd: 0, limitMicroUsd: DEFAULT_AI_BUDGET_LIMITS.dayMicroUsd },
      month: { spentMicroUsd: 0, limitMicroUsd: DEFAULT_AI_BUDGET_LIMITS.monthMicroUsd },
      staleReservations: 0,
    },
    days: 31,
    daily: [],
    monthly: [],
  };
}

/** Formatowanie kwoty w USD (koszt dostawcy jest naliczany w USD). */
export function createUsdFormatter(locale: string): (microUsd: number) => string {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (microUsd) => fmt.format(microUsd / 1_000_000);
}
