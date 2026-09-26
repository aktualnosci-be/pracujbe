import { aiBudgetLevel, aiBudgetPercent, type AiBudgetStatus } from '@/lib/admin/ai-costs';
import { BACKUP_MAX_AGE_SECONDS, backupAlerts, type BackupFreshness, type BackupSignal } from '@/lib/ops/backup-freshness';
import {
  evaluateOps,
  OPS_THRESHOLDS,
  type AppPoolStats,
  type MaintenanceRun,
  type OpsMetrics,
  type OpsSignal,
} from '@/lib/ops/sensors';

/**
 * Panel `/admin/operacje` (#47): mapowanie wyniku czujek na wiersze tabeli. Moduł czysty (bez I/O).
 *
 * Stan wiersza pochodzi WYŁĄCZNIE z list `alerts`/`warnings` wyliczonych przez `evaluateOps`
 * (i `backupAlerts`) — panel nie liczy progów drugi raz, więc pokazuje dokładnie te same stany co
 * `/api/health/ops`. Wartość i próg służą tylko do wyświetlenia. Brak sekcji w metrykach (baza
 * sprzed migracji) albo nieudany odczyt = `noData`, nigdy „ok”.
 */

export type OpsRowState = 'ok' | 'warning' | 'alert' | 'noData';

export type OpsValue =
  | { kind: 'seconds'; value: number }
  | { kind: 'count'; value: number }
  | { kind: 'percent'; value: number }
  | { kind: 'none' };

export type OpsSection = 'queues' | 'maintenance' | 'storage' | 'mail' | 'aiBudget' | 'database' | 'backup';

export const OPS_SECTIONS: readonly OpsSection[] = [
  'queues',
  'maintenance',
  'storage',
  'mail',
  'aiBudget',
  'database',
  'backup',
];

export type OpsRowId =
  | 'emailQueueAge'
  | 'emailLeases'
  | 'emailFailed'
  | 'authQueueAge'
  | 'authLeases'
  | 'authFailed'
  | 'webhooksStuck'
  | 'webhooksFailed'
  | 'maintenanceLastRun'
  | 'maintenanceLag'
  | 'storageAge'
  | 'storageDeadLetters'
  | 'mailBounceRate'
  | 'mailComplaintRate'
  | 'mailNewSuppressions'
  | 'mailActiveSuppressions'
  | 'aiBudgetDay'
  | 'aiBudgetMonth'
  | 'aiStaleReservations'
  | 'dbConnections'
  | 'appPoolWaiting'
  | 'backupAge';

/**
 * Próg: `max` = sygnał powyżej wartości; `positive` = każda wartość > 0; `budget` = ostrzeżenie
 * od `warningPercent`, alarm od `alertPercent` wykorzystania limitu (`aiBudgetLevel`).
 */
export type OpsThreshold =
  | { kind: 'max'; value: OpsValue }
  | { kind: 'positive' }
  | { kind: 'budget'; warningPercent: number; alertPercent: number };

/**
 * Uwaga do wiersza (klucz i18n `admin.opsNote*`) — np. za mała próba poczty albo brak przebiegu.
 * Same liczby w parametrach.
 */
export type OpsNote =
  | { key: 'smallSample'; sent: number; min: number }
  | { key: 'queueReady'; ready: number }
  | { key: 'lastRunNever' }
  | { key: 'lastRunFailed'; task: string }
  | { key: 'lastRunUnknown' }
  | { key: 'lagDetail'; jobs: number; discounts: number; checkouts: number }
  | { key: 'storagePending'; pending: number }
  | { key: 'connections'; used: number; available: number }
  | { key: 'backupStatus'; status: Exclude<BackupFreshness['status'], 'ok' | 'stale'> }
  | { key: 'aiNoLimit' };

export interface OpsRow {
  id: OpsRowId;
  section: OpsSection;
  value: OpsValue;
  threshold: OpsThreshold;
  state: OpsRowState;
  /** Sygnały czujek, które decydują o stanie wiersza (te same kody co w `/api/health/ops`). */
  signals: readonly (OpsSignal | BackupSignal)[];
  note?: OpsNote;
}

export interface OpsDashboardInput {
  alerts: readonly (OpsSignal | BackupSignal)[];
  warnings: readonly OpsSignal[];
  metrics: OpsMetrics;
  appPool: AppPoolStats | null;
  aiBudget: AiBudgetStatus | null;
  maintenanceRun: MaintenanceRun | null | undefined;
  backup: BackupFreshness;
}

const NONE: OpsValue = { kind: 'none' };
const seconds = (value: number): OpsValue => ({ kind: 'seconds', value });
const count = (value: number): OpsValue => ({ kind: 'count', value });
const percent = (value: number): OpsValue => ({ kind: 'percent', value });
const maxOf = (value: OpsValue): OpsThreshold => ({ kind: 'max', value });
const POSITIVE: OpsThreshold = { kind: 'positive' };

/** Odsetek z dokładnością do 0,01 pp (0,3% skarg musi być widoczne). */
function ratioPercent(events: number, total: number): number {
  return total > 0 ? Math.round((events / total) * 10_000) / 100 : 0;
}

export function buildOpsRows(input: OpsDashboardInput): OpsRow[] {
  const alerts = new Set<string>(input.alerts);
  const warnings = new Set<string>(input.warnings);
  const stateOf = (signals: readonly string[], available = true): OpsRowState => {
    if (signals.some((s) => alerts.has(s))) return 'alert';
    if (signals.some((s) => warnings.has(s))) return 'warning';
    return available ? 'ok' : 'noData';
  };
  const row = (
    id: OpsRowId,
    section: OpsSection,
    value: OpsValue,
    threshold: OpsThreshold,
    signals: readonly (OpsSignal | BackupSignal)[],
    available = true,
    note?: OpsNote,
  ): OpsRow => ({
    id,
    section,
    value: available ? value : NONE,
    threshold,
    state: stateOf(signals, available),
    signals,
    ...(note ? { note } : {}),
  });

  const { metrics: m, aiBudget, maintenanceRun: run, backup } = input;
  const t = OPS_THRESHOLDS;
  const rows: OpsRow[] = [];

  // --- Kolejki -------------------------------------------------------------------------------
  rows.push(
    row('emailQueueAge', 'queues', seconds(m.email.oldestReadyAgeSeconds), maxOf(seconds(t.emailOldestReadySeconds)),
      ['email_queue_age'], true, { key: 'queueReady', ready: m.email.ready }),
    row('emailLeases', 'queues', count(m.email.abandonedLeases), POSITIVE, ['email_lease_abandoned']),
    row('emailFailed', 'queues', count(m.email.failedLast24h), POSITIVE, ['email_failed']),
  );
  const auth = m.authEmail;
  rows.push(
    row('authQueueAge', 'queues', seconds(auth?.oldestReadyAgeSeconds ?? 0), maxOf(seconds(t.authEmailOldestReadySeconds)),
      ['auth_email_queue_age'], auth !== null, auth ? { key: 'queueReady', ready: auth.ready } : undefined),
    row('authLeases', 'queues', count(auth?.abandonedLeases ?? 0), POSITIVE, ['auth_email_lease_abandoned'], auth !== null),
    row('authFailed', 'queues', count(auth?.failedLast24h ?? 0), POSITIVE, ['auth_email_failed'], auth !== null),
    row('webhooksStuck', 'queues', count(m.webhooks.stuckProcessing), POSITIVE, ['webhook_stuck']),
    row('webhooksFailed', 'queues', count(m.webhooks.failedLast24h), POSITIVE, ['webhook_failed']),
  );

  // --- Maintenance ---------------------------------------------------------------------------
  const runSignals = [
    'maintenance_run_stale',
    'maintenance_run_failed',
    'maintenance_run_missing',
    'maintenance_run_unavailable',
  ] as const;
  const runNote: OpsNote | undefined =
    run === null
      ? { key: 'lastRunUnknown' }
      : run?.ageSeconds === null
        ? { key: 'lastRunNever' }
        : run?.ok === false && run.failedTask
          ? { key: 'lastRunFailed', task: run.failedTask }
          : undefined;
  rows.push(
    row('maintenanceLastRun', 'maintenance', run && run.ageSeconds !== null ? seconds(run.ageSeconds) : NONE,
      maxOf(seconds(t.maintenanceRunMaxAgeSeconds)), runSignals, run !== undefined && run !== null && run.ageSeconds !== null, runNote),
  );
  const lag = m.maintenance;
  rows.push(
    row('maintenanceLag', 'maintenance',
      count(lag.overdueActiveJobs + lag.staleDiscountReservations + lag.staleCheckoutIntents), POSITIVE,
      ['maintenance_lag'], true,
      { key: 'lagDetail', jobs: lag.overdueActiveJobs, discounts: lag.staleDiscountReservations, checkouts: lag.staleCheckoutIntents }),
  );

  // --- Kolejka storage (#574) ------------------------------------------------------------------
  const storage = m.storageDeletion;
  rows.push(
    row('storageAge', 'storage', seconds(storage?.oldestPendingAgeSeconds ?? 0), maxOf(seconds(t.storageDeletionOldestSeconds)),
      ['storage_deletion_age'], storage !== undefined, storage ? { key: 'storagePending', pending: storage.pending } : undefined),
    row('storageDeadLetters', 'storage', count(storage?.deadLetters ?? 0), POSITIVE,
      ['storage_deletion_dead_letter'], storage !== undefined),
  );

  // --- Poczta (#44) ------------------------------------------------------------------------------
  const mail = m.mail;
  const smallSample: OpsNote | undefined =
    mail && mail.sentLast24h < t.mailMinSample ? { key: 'smallSample', sent: mail.sentLast24h, min: t.mailMinSample } : undefined;
  rows.push(
    row('mailBounceRate', 'mail', percent(ratioPercent(mail?.hardBouncesLast24h ?? 0, mail?.sentLast24h ?? 0)),
      maxOf(percent(t.mailHardBounceRate * 100)), ['mail_hard_bounce_rate', 'mail_hard_bounce_rising'], mail !== null, smallSample),
    row('mailComplaintRate', 'mail', percent(ratioPercent(mail?.complaintsLast24h ?? 0, mail?.sentLast24h ?? 0)),
      maxOf(percent(t.mailComplaintRate * 100)), ['mail_complaint_rate', 'mail_complaint_rising'], mail !== null, smallSample),
    row('mailNewSuppressions', 'mail', count(mail?.newSuppressionsLast24h ?? 0), maxOf(count(t.mailNewSuppressions)),
      ['mail_suppressions_new'], mail !== null),
    row('mailActiveSuppressions', 'mail', count(mail?.activeSuppressions ?? 0), maxOf(count(t.mailActiveSuppressions)),
      ['mail_suppressions_active'], mail !== null),
  );

  // --- Budżet AI (#36) --------------------------------------------------------------------------
  // Sygnały budżetu są wspólne dla doby i miesiąca — okres poniżej progu (`aiBudgetLevel` = ok)
  // nie przejmuje stanu drugiego okresu.
  const period = (id: 'aiBudgetDay' | 'aiBudgetMonth', p: AiBudgetStatus['day'] | undefined): OpsRow => {
    const built = row(id, 'aiBudget', p ? percent(aiBudgetPercent(p)) : NONE,
      { kind: 'budget', warningPercent: 80, alertPercent: 100 },
      ['ai_budget_exhausted', 'ai_budget_near_limit', 'ai_budget_unavailable'], aiBudget !== null,
      p && p.limitMicroUsd === null ? { key: 'aiNoLimit' } : undefined);
    return p && aiBudgetLevel(p) === 'ok' ? { ...built, state: stateOf(['ai_budget_unavailable']) } : built;
  };
  rows.push(
    period('aiBudgetDay', aiBudget?.day),
    period('aiBudgetMonth', aiBudget?.month),
    row('aiStaleReservations', 'aiBudget', count(aiBudget?.staleReservations ?? 0), POSITIVE,
      ['ai_budget_stale_reservation'], aiBudget !== null),
  );

  // --- Baza i pula -------------------------------------------------------------------------------
  const available = Math.max(0, m.connections.max - m.connections.reserved);
  rows.push(
    row('dbConnections', 'database', percent(available > 0 ? Math.round((m.connections.used / available) * 100) : 100),
      maxOf(percent(t.connectionsRatio * 100)), ['db_connections'], true,
      { key: 'connections', used: m.connections.used, available }),
    row('appPoolWaiting', 'database', count(input.appPool?.waiting ?? 0), POSITIVE, ['app_pool_waiting'], input.appPool !== null),
  );

  // --- Kopia bazy (#569) -------------------------------------------------------------------------
  const backupSignals: BackupSignal[] = ['backup_stale', 'backup_missing', 'backup_unavailable', 'backup_misconfigured', 'backup_unconfigured'];
  const backupThreshold = maxOf(seconds(BACKUP_MAX_AGE_SECONDS));
  rows.push(
    backup.status === 'ok' || backup.status === 'stale'
      ? row('backupAge', 'backup', seconds(backup.ageSeconds), backupThreshold, backupSignals)
      : row('backupAge', 'backup', NONE, backupThreshold, backupSignals, false, { key: 'backupStatus', status: backup.status }),
  );

  return rows;
}

/** Stan zbiorczy panelu = ten sam co `status` w `/api/health/ops`. */
export function opsOverallState(alerts: readonly string[], warnings: readonly string[]): 'ok' | 'warning' | 'alert' {
  if (alerts.length > 0) return 'alert';
  return warnings.length > 0 ? 'warning' : 'ok';
}

/**
 * Tryb DEMO (bez bazy): przykładowy stan oznaczony na stronie — kolejki zdrowe, maintenance
 * jeszcze nigdy nie ruszył (jak przed uruchomieniem crona), kopia nieskonfigurowana. Sygnały
 * liczy ten sam `evaluateOps`, więc demo pokazuje realne reguły, a nie wymyślone stany.
 */
export function demoOpsInput(): OpsDashboardInput {
  const metrics: OpsMetrics = {
    email: { ready: 3, oldestReadyAgeSeconds: 42, abandonedLeases: 0, failedLast24h: 0 },
    authEmail: { ready: 0, oldestReadyAgeSeconds: 0, abandonedLeases: 0, failedLast24h: 0 },
    webhooks: { stuckProcessing: 0, failedLast24h: 0 },
    maintenance: { overdueActiveJobs: 0, staleDiscountReservations: 0, staleCheckoutIntents: 0 },
    connections: { used: 12, max: 100, reserved: 3 },
    storageDeletion: { pending: 0, oldestPendingAgeSeconds: 0, deadLetters: 0 },
    mail: {
      sentLast24h: 18,
      hardBouncesLast24h: 0,
      complaintsLast24h: 0,
      sentBaseline7d: 120,
      hardBouncesBaseline7d: 1,
      complaintsBaseline7d: 0,
      activeSuppressions: 2,
      newSuppressionsLast24h: 0,
    },
  };
  const aiBudget: AiBudgetStatus = {
    day: { spentMicroUsd: 120_000, limitMicroUsd: 10_000_000 },
    month: { spentMicroUsd: 2_400_000, limitMicroUsd: 100_000_000 },
    staleReservations: 0,
  };
  const maintenanceRun: MaintenanceRun = { finishedAt: null, ageSeconds: null, ok: null, durationMs: null, failedTask: null };
  const backup: BackupFreshness = { status: 'unconfigured' };
  const appPool: AppPoolStats = { total: 2, idle: 2, waiting: 0, max: 10 };
  const evaluation = evaluateOps(metrics, appPool, aiBudget, maintenanceRun);
  return {
    alerts: [...evaluation.alerts, ...backupAlerts(backup)],
    warnings: evaluation.warnings,
    metrics,
    appPool,
    aiBudget,
    maintenanceRun,
    backup,
  };
}
