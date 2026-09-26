import 'server-only';

import type { AiBudgetStatus } from '@/lib/admin/ai-costs';
import { domainPoolStats } from '@/lib/db/runtime';
import {
  backupAlerts,
  readBackupFreshness,
  type BackupFreshness,
  type BackupSignal,
} from '@/lib/ops/backup-freshness';
import { readOpsMetrics } from '@/lib/ops/metrics-source';
import {
  evaluateOps,
  type AppPoolStats,
  type MaintenanceRun,
  type OpsMetrics,
  type OpsSignal,
} from '@/lib/ops/sensors';

/**
 * Jeden odczyt stanu czujek (#47) dla `/api/health/ops` i panelu `/admin/operacje` — oba widoki
 * pokazują te same liczby i te same sygnały (progi w `sensors.ts`, kopia w `backup-freshness.ts`).
 * Same liczby i kody — bez adresów, treści, identyfikatorów i konfiguracji.
 */
export type OpsStatus =
  | {
      kind: 'ok';
      status: 'ok' | 'alert';
      alerts: Array<OpsSignal | BackupSignal>;
      warnings: OpsSignal[];
      metrics: OpsMetrics;
      appPool: AppPoolStats | null;
      aiBudget: AiBudgetStatus | null;
      /** `undefined` = baza sprzed 0213 (czujka nie mierzy), `null` = odczyt się nie udał. */
      maintenanceRun: MaintenanceRun | null | undefined;
      backup: BackupFreshness;
    }
  | { kind: 'unconfigured'; backup: BackupFreshness }
  | { kind: 'unavailable'; backup: BackupFreshness };

export async function readOpsStatus(): Promise<OpsStatus> {
  const [result, backup] = await Promise.all([readOpsMetrics(), readBackupFreshness()]);
  if (result.kind !== 'ok') {
    return result.kind === 'unconfigured' ? { kind: 'unconfigured', backup } : { kind: 'unavailable', backup };
  }
  const appPool = domainPoolStats();
  const evaluation = evaluateOps(result.metrics, appPool, result.aiBudget, result.maintenanceRun);
  const alerts = [...evaluation.alerts, ...backupAlerts(backup)];
  return {
    kind: 'ok',
    status: alerts.length ? 'alert' : 'ok',
    alerts,
    warnings: evaluation.warnings,
    metrics: result.metrics,
    appPool,
    aiBudget: result.aiBudget ?? null,
    maintenanceRun: result.maintenanceRun,
    backup,
  };
}
