import 'server-only';

import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

import { parseOpsMetrics, type OpsMetrics } from './sensors';

export type OpsMetricsResult =
  | { kind: 'ok'; metrics: OpsMetrics }
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
    if (process.env.DATABASE_OPS_URL) {
      const { getOpsPool } = await import('@/lib/db/runtime');
      const pool = await getOpsPool();
      const result = await pool.query<{ metrics: unknown }>('SELECT public.ops_metrics() AS metrics');
      raw = result.rows[0]?.metrics;
    } else if (isServiceDatabaseConfigured()) {
      raw = await withServiceRole((tx) => rpc(tx, 'ops_metrics'));
    } else {
      return { kind: 'unconfigured' };
    }
    const metrics = parseOpsMetrics(raw);
    if (!metrics) {
      captureError(new Error('ops_metrics: nieoczekiwany kształt'), { area: 'ops.metrics' });
      return { kind: 'error' };
    }
    return { kind: 'ok', metrics };
  } catch (e) {
    captureError(e, { area: 'ops.metrics' });
    return { kind: 'error' };
  }
}
