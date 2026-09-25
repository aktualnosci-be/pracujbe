import { z } from 'zod/v3';

import { aiBudgetLevel, type AiBudgetStatus } from '@/lib/admin/ai-costs';

/**
 * Czujki operacyjne (#47). Baza zwraca same liczby (`public.ops_metrics()`, 0096);
 * tutaj — walidacja kształtu i progi alarmowe. Moduł jest czysty (bez I/O), więc
 * progi są testowane jednostkowo, a endpoint `/api/health/ops` tylko go wywołuje.
 *
 * `alerts` = stan wymagający reakcji (HTTP 503 — monitor podnosi alarm), `warnings` =
 * sygnał do przeglądu bez alarmu (HTTP 200). Powrót do `ok` = sygnał recovery.
 */

const count = z.number().int().nonnegative();

const queueSchema = z.object({
  ready: count,
  oldestReadyAgeSeconds: count,
  abandonedLeases: count,
  failedLast24h: count,
});

export const opsMetricsSchema = z.object({
  email: queueSchema,
  authEmail: queueSchema.nullable(),
  webhooks: z.object({ stuckProcessing: count, failedLast24h: count }),
  maintenance: z.object({
    overdueActiveJobs: count,
    staleDiscountReservations: count,
    staleCheckoutIntents: count,
  }),
  connections: z.object({ used: count, max: count, reserved: count }),
});

export type OpsMetrics = z.infer<typeof opsMetricsSchema>;

export interface AppPoolStats {
  total: number;
  idle: number;
  waiting: number;
  max: number;
}

export const OPS_THRESHOLDS = {
  /** Worker e-mail co 5 min + dzierżawa 300 s: 15 min = co najmniej dwa pominięte przebiegi. */
  emailOldestReadySeconds: 15 * 60,
  /** E-maile auth (weryfikacja, reset hasła) — użytkownik czeka na nie od razu. */
  authEmailOldestReadySeconds: 5 * 60,
  /** Udział połączeń PostgreSQL dostępnych dla aplikacji (max − zarezerwowane). */
  connectionsRatio: 0.8,
} as const;

export type OpsSignal =
  | 'email_queue_age'
  | 'email_lease_abandoned'
  | 'email_failed'
  | 'auth_email_queue_age'
  | 'auth_email_lease_abandoned'
  | 'auth_email_failed'
  | 'webhook_stuck'
  | 'webhook_failed'
  | 'maintenance_lag'
  | 'db_connections'
  | 'app_pool_waiting'
  | 'ai_budget_exhausted'
  | 'ai_budget_near_limit'
  | 'ai_budget_stale_reservation'
  | 'ai_budget_unavailable';

export interface OpsEvaluation {
  status: 'ok' | 'alert';
  alerts: OpsSignal[];
  warnings: OpsSignal[];
}

export function parseOpsMetrics(raw: unknown): OpsMetrics | null {
  const parsed = opsMetricsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * @param aiBudget stan budżetu AI (#36, `ai_budget_status()` z 0109): `null` = odczyt się nie
 *   udał (ostrzeżenie — rezerwacje i tak odmawiają przy błędzie bazy), `undefined` = nie mierzono.
 */
export function evaluateOps(
  metrics: OpsMetrics,
  pool: AppPoolStats | null = null,
  aiBudget?: AiBudgetStatus | null,
): OpsEvaluation {
  const alerts: OpsSignal[] = [];
  const warnings: OpsSignal[] = [];

  if (metrics.email.oldestReadyAgeSeconds > OPS_THRESHOLDS.emailOldestReadySeconds) alerts.push('email_queue_age');
  if (metrics.email.abandonedLeases > 0) alerts.push('email_lease_abandoned');
  if (metrics.email.failedLast24h > 0) warnings.push('email_failed');

  const auth = metrics.authEmail;
  if (auth) {
    if (auth.oldestReadyAgeSeconds > OPS_THRESHOLDS.authEmailOldestReadySeconds) alerts.push('auth_email_queue_age');
    if (auth.abandonedLeases > 0) alerts.push('auth_email_lease_abandoned');
    if (auth.failedLast24h > 0) warnings.push('auth_email_failed');
  }

  if (metrics.webhooks.stuckProcessing > 0) alerts.push('webhook_stuck');
  if (metrics.webhooks.failedLast24h > 0) warnings.push('webhook_failed');

  const m = metrics.maintenance;
  if (m.overdueActiveJobs > 0 || m.staleDiscountReservations > 0 || m.staleCheckoutIntents > 0) {
    alerts.push('maintenance_lag');
  }

  const available = metrics.connections.max - metrics.connections.reserved;
  if (available <= 0 || metrics.connections.used >= available * OPS_THRESHOLDS.connectionsRatio) {
    alerts.push('db_connections');
  }

  // Żądania czekające na połączenie puli procesu = pula za mała albo zablokowane zapytania.
  if (pool && pool.waiting > 0) warnings.push('app_pool_waiting');

  // Budżet AI (#36): wyczerpany limit (albo limit 0 / brak limitu) = funkcje AI zablokowane →
  // alarm; ≥ 80% limitu i rezerwacje bez rozliczenia = ostrzeżenia.
  if (aiBudget === null) {
    warnings.push('ai_budget_unavailable');
  } else if (aiBudget) {
    const levels = [aiBudgetLevel(aiBudget.day), aiBudgetLevel(aiBudget.month)];
    if (levels.includes('exhausted')) alerts.push('ai_budget_exhausted');
    else if (levels.includes('warning')) warnings.push('ai_budget_near_limit');
    if (aiBudget.staleReservations > 0) warnings.push('ai_budget_stale_reservation');
  }

  return { status: alerts.length > 0 ? 'alert' : 'ok', alerts, warnings };
}
