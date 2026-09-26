/**
 * Warstwa danych panelu administratora — stan operacyjny (#47, `/admin/operacje`).
 *
 * Jak inne odczyty admina: najpierw `requireAdmin` (gdy portal ma bazę — inna rola → `notFound()`),
 * dopiero potem odczyt czujek przez istniejący kod ops (`readOpsStatus`: pula `ops` z
 * `DATABASE_OPS_URL`, zapasowo transakcja service_role). Ten sam odczyt obsługuje
 * `/api/health/ops`, więc panel pokazuje te same liczby i stany. Same liczby i kody —
 * bez danych osobowych, adresów i sekretów. Bez bazy (tryb DEMO) — przykładowy stan oznaczony.
 */

import 'server-only';

import { requireAdmin } from '@/lib/data/admin';
import { isPortalDataConfigured } from '@/lib/db/portal';
import { captureError } from '@/lib/error-report';
import {
  buildOpsRows,
  demoOpsInput,
  opsOverallState,
  type OpsDashboardInput,
  type OpsRow,
} from '@/lib/ops/dashboard';
import type { MaintenanceRun } from '@/lib/ops/sensors';

export type OpsDashboardResult =
  | {
      status: 'ok';
      demo: boolean;
      overall: 'ok' | 'warning' | 'alert';
      rows: OpsRow[];
      /** Czas zakończenia ostatniego przebiegu maintenance (ISO) albo `null`. */
      lastMaintenanceAt: string | null;
      checkedAt: string;
    }
  /** Brak źródła metryk (`DATABASE_OPS_URL` ani service-role). */
  | { status: 'unconfigured'; checkedAt: string }
  /** Odczyt się nie udał (szczegół w kanale błędów). */
  | { status: 'unavailable'; checkedAt: string };

function toResult(input: OpsDashboardInput, demo: boolean, checkedAt: string): OpsDashboardResult {
  const run: MaintenanceRun | null | undefined = input.maintenanceRun;
  return {
    status: 'ok',
    demo,
    overall: opsOverallState(input.alerts, input.warnings),
    rows: buildOpsRows(input),
    lastMaintenanceAt: run?.finishedAt ?? null,
    checkedAt,
  };
}

export async function getOpsDashboard(): Promise<OpsDashboardResult> {
  const checkedAt = new Date().toISOString();
  if (!isPortalDataConfigured()) return toResult(demoOpsInput(), true, checkedAt);
  await requireAdmin();
  try {
    const { readOpsStatus } = await import('@/lib/ops/status');
    const status = await readOpsStatus();
    if (status.kind !== 'ok') return { status: status.kind === 'unconfigured' ? 'unconfigured' : 'unavailable', checkedAt };
    return toResult(status, false, checkedAt);
  } catch (error) {
    captureError(error, { area: 'adminOps.read' });
    return { status: 'unavailable', checkedAt };
  }
}
