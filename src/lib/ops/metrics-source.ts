import 'server-only';

import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

import { parseAiBudgetStatus, type AiBudgetStatus } from '@/lib/admin/ai-costs';

import { parseMaintenanceRun, parseOpsMetrics, type MaintenanceRun, type OpsMetrics } from './sensors';

export type OpsMetricsResult =
  /** `aiBudget` = `null`, gdy stanu budżetu AI (#36) nie udało się odczytać. */
  | {
      kind: 'ok';
      metrics: OpsMetrics;
      aiBudget: AiBudgetStatus | null;
      /** 0213: `null` = odczyt się nie udał; `undefined` = baza sprzed 0213 (brak funkcji). */
      maintenanceRun?: MaintenanceRun | null;
    }
  | { kind: 'unconfigured' }
  | { kind: 'error' };

/**
 * Odczyt `public.ops_metrics()` (#47, 0096). Kolejność źródeł:
 * 1. `DATABASE_OPS_URL` — PostgreSQL Railway: osobny login z członkostwem WYŁĄCZNIE
 *    w `pracujbe_ops` (kontrola uprawnień w `createRuntimePool`, jedna sesja na proces);
 * 2. pula zadań serwerowych (`DATABASE_SERVICE_URL`, transakcja service_role — ścieżka
 *    zapasowa, jak `/api/maintenance`).
 * Błąd sterownika nie wychodzi poza moduł (może zawierać adres lub login) — tylko kanał błędów.
 */
export async function readOpsMetrics(): Promise<OpsMetricsResult> {
  try {
    let raw: unknown;
    let rawBudget: unknown;
    let rawRun: unknown;
    if (process.env.DATABASE_OPS_URL) {
      const { getOpsPool } = await import('@/lib/db/runtime');
      const pool = await getOpsPool();
      const result = await pool.query<{ metrics: unknown }>('SELECT public.ops_metrics() AS metrics');
      raw = result.rows[0]?.metrics;
      rawBudget = await readBudget(async () => {
        const budget = await pool.query<{ budget: unknown }>('SELECT public.ai_budget_status() AS budget');
        return budget.rows[0]?.budget;
      });
      rawRun = await readOptional('ops_last_maintenance_run', async () => {
        const run = await pool.query<{ run: unknown }>('SELECT public.ops_last_maintenance_run() AS run');
        return run.rows[0]?.run;
      });
    } else if (isServiceDatabaseConfigured()) {
      raw = await withServiceRole((tx) => rpc(tx, 'ops_metrics'));
      rawBudget = await readBudget(() => withServiceRole((tx) => rpc(tx, 'ai_budget_status')));
      rawRun = await readOptional('ops_last_maintenance_run', () =>
        withServiceRole((tx) => rpc(tx, 'ops_last_maintenance_run')),
      );
    } else {
      return { kind: 'unconfigured' };
    }
    const metrics = parseOpsMetrics(raw);
    if (!metrics) {
      captureError(new Error('ops_metrics: nieoczekiwany kształt'), { area: 'ops.metrics' });
      return { kind: 'error' };
    }
    const aiBudget = rawBudget === undefined ? null : parseAiBudgetStatus(rawBudget);
    if (rawBudget !== undefined && !aiBudget) {
      captureError(new Error('ai_budget_status: nieoczekiwany kształt'), { area: 'ops.metrics' });
    }
    let maintenanceRun: MaintenanceRun | null | undefined;
    if (rawRun === MISSING_FUNCTION) maintenanceRun = undefined;
    else if (rawRun === undefined) maintenanceRun = null;
    else {
      maintenanceRun = parseMaintenanceRun(rawRun);
      if (!maintenanceRun) {
        captureError(new Error('ops_last_maintenance_run: nieoczekiwany kształt'), { area: 'ops.metrics' });
      }
    }
    return { kind: 'ok', metrics, aiBudget, maintenanceRun };
  } catch (e) {
    captureError(e, { area: 'ops.metrics' });
    return { kind: 'error' };
  }
}

/** Stan budżetu AI osobno: jego awaria nie ukrywa pozostałych czujek (→ ostrzeżenie). */
async function readBudget(read: () => Promise<unknown>): Promise<unknown> {
  try {
    return (await read()) ?? undefined;
  } catch (e) {
    captureError(e, { area: 'ops.metrics', step: 'ai_budget_status' });
    return undefined;
  }
}

/** Znacznik „funkcja nie istnieje” (baza sprzed migracji) — czujka milczy zamiast ostrzegać. */
const MISSING_FUNCTION = Symbol('missing-function');

/** Odczyt opcjonalny: brak funkcji (42883) = MISSING_FUNCTION, inny błąd = `undefined` (ostrzeżenie). */
async function readOptional(step: string, read: () => Promise<unknown>): Promise<unknown> {
  try {
    return (await read()) ?? undefined;
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === '42883') return MISSING_FUNCTION;
    captureError(e, { area: 'ops.metrics', step });
    return undefined;
  }
}
