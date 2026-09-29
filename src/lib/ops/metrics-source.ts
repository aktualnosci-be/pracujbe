import 'server-only';

import { isDatabaseError } from '@/lib/db/errors';
import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

import { parseAiBudgetStatus, type AiBudgetStatus } from '@/lib/admin/ai-costs';

import { parseOpsMetrics, type OpsMetrics } from './sensors';
import { parseSchemaState, type SchemaStateResult } from './schema-state';

export type OpsMetricsResult =
  /** `aiBudget` = `null`, gdy stanu budżetu AI (#36) nie udało się odczytać. */
  | { kind: 'ok'; metrics: OpsMetrics; aiBudget: AiBudgetStatus | null }
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
    if (process.env.DATABASE_OPS_URL) {
      const { getOpsPool } = await import('@/lib/db/runtime');
      const pool = await getOpsPool();
      const result = await pool.query<{ metrics: unknown }>('SELECT public.ops_metrics() AS metrics');
      raw = result.rows[0]?.metrics;
      rawBudget = await readBudget(async () => {
        const budget = await pool.query<{ budget: unknown }>('SELECT public.ai_budget_status() AS budget');
        return budget.rows[0]?.budget;
      });
    } else if (isServiceDatabaseConfigured()) {
      raw = await withServiceRole((tx) => rpc(tx, 'ops_metrics'));
      rawBudget = await readBudget(() => withServiceRole((tx) => rpc(tx, 'ai_budget_status')));
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
    return { kind: 'ok', metrics, aiBudget };
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

/**
 * Odczyt `public.ops_schema_state()` (0964, #1065) tym samym kanałem co `ops_metrics()`: login
 * `DATABASE_OPS_URL`, zapasowo pula zadań serwerowych. Brak funkcji (SQLSTATE 42883) = baza
 * sprzed migracji 0964, czyli za kodem — osobny wynik, nie błąd.
 */
export async function readSchemaState(): Promise<SchemaStateResult> {
  try {
    let raw: unknown;
    if (process.env.DATABASE_OPS_URL) {
      const { getOpsPool } = await import('@/lib/db/runtime');
      const pool = await getOpsPool();
      const result = await pool.query<{ state: unknown }>('SELECT public.ops_schema_state() AS state');
      raw = result.rows[0]?.state;
    } else if (isServiceDatabaseConfigured()) {
      raw = await withServiceRole((tx) => rpc(tx, 'ops_schema_state'));
    } else {
      return { kind: 'unconfigured' };
    }
    const state = parseSchemaState(raw);
    if (!state) {
      captureError(new Error('ops_schema_state: nieoczekiwany kształt'), { area: 'ops.schema-state' });
      return { kind: 'error' };
    }
    return { kind: 'ok', state };
  } catch (e) {
    if (isDatabaseError(e) && e.code === '42883') return { kind: 'missing' };
    captureError(e, { area: 'ops.schema-state' });
    return { kind: 'error' };
  }
}
