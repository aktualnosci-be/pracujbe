import 'server-only';

import type { AiBudgetStatus } from '@/lib/admin/ai-costs';
import { domainPoolStats } from '@/lib/db/runtime';
import {
  backupAlerts,
  readBackupFreshness,
  type BackupFreshness,
  type BackupSignal,
} from '@/lib/ops/backup-freshness';
import { readOpsMetrics, readSchemaState } from '@/lib/ops/metrics-source';
import {
  portalLegalModeAlerts,
  portalLegalModeSummary,
  type PortalLegalModeSignal,
} from '@/lib/ops/portal-mode';
import {
  expectedMigrationFromEnv,
  schemaAlerts,
  schemaSummary,
  type SchemaSignal,
} from '@/lib/ops/schema-state';
import {
  evaluateOps,
  type AppPoolStats,
  type MaintenanceRun,
  type OpsMetrics,
  type OpsSignal,
} from '@/lib/ops/sensors';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { emailFromProblem } from '@/lib/email/sender';

/**
 * Jeden odczyt stanu czujek (#47) dla `/api/health/ops` i panelu `/admin/operacje` — oba widoki
 * pokazują te same liczby i te same sygnały (progi w `sensors.ts`, kopia w `backup-freshness.ts`).
 * Same liczby i kody — bez adresów, treści, identyfikatorów i konfiguracji.
 */
export type OpsStatus =
  | {
      kind: 'ok';
      status: 'ok' | 'alert';
      alerts: Array<OpsSignal | BackupSignal | PortalLegalModeSignal | SchemaSignal>;
      warnings: OpsSignal[];
      metrics: OpsMetrics;
      appPool: AppPoolStats | null;
      aiBudget: AiBudgetStatus | null;
      /** `undefined` = baza sprzed 0180 (czujka nie mierzy), `null` = odczyt się nie udał. */
      maintenanceRun: MaintenanceRun | null | undefined;
      backup: BackupFreshness;
      /** #1143: nazwy trybów env/bazy/efektywnego (dwuklucz), bez konfiguracji. */
      portalLegalMode: ReturnType<typeof portalLegalModeSummary>;
      /** #1065: oczekiwana/zastosowana migracja (nazwy), bez konfiguracji. */
      schema: ReturnType<typeof schemaSummary>;
    }
  | { kind: 'unconfigured'; backup: BackupFreshness }
  | { kind: 'unavailable'; backup: BackupFreshness };

export async function readOpsStatus(): Promise<OpsStatus> {
  // Stan schematu czytamy tylko, gdy build zna oczekiwaną migrację (dev/testy bez niej nie płacą zapytaniem).
  const expectedMigration = expectedMigrationFromEnv();
  const [result, backup, schemaState] = await Promise.all([
    readOpsMetrics(),
    readBackupFreshness(),
    expectedMigration ? readSchemaState() : Promise.resolve({ kind: 'unconfigured' } as const),
  ]);
  if (result.kind !== 'ok') {
    return result.kind === 'unconfigured' ? { kind: 'unconfigured', backup } : { kind: 'unavailable', backup };
  }
  const appPool = domainPoolStats();
  const evaluation = evaluateOps(
    result.metrics,
    appPool,
    result.aiBudget,
    result.maintenanceRun,
    emailFromProblem(process.env) === null,
  );
  // #1143: env i baza muszą mówić to samo; rozbieżność = alarm (tryb efektywny i tak ogłoszeniowy).
  const envRecruitment = isRecruitmentEnabled();
  const dbRecruitment = result.metrics.portalLegalMode?.recruitmentEnabled;
  const alerts = [
    ...evaluation.alerts,
    ...portalLegalModeAlerts(dbRecruitment, envRecruitment),
    ...backupAlerts(backup),
    ...schemaAlerts(expectedMigration, schemaState),
  ];
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
    portalLegalMode: portalLegalModeSummary(dbRecruitment, envRecruitment),
    schema: schemaSummary(expectedMigration, schemaState),
  };
}
