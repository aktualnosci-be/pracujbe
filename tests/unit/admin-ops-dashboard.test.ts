import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backupAlerts, type BackupFreshness } from '@/lib/ops/backup-freshness';
import { buildOpsRows, demoOpsInput, opsOverallState, type OpsDashboardInput, type OpsRow } from '@/lib/ops/dashboard';
import {
  evaluateOps,
  parseMaintenanceRun,
  type AppPoolStats,
  type MaintenanceRun,
  type OpsMetrics,
} from '@/lib/ops/sensors';
import type { AiBudgetStatus } from '@/lib/admin/ai-costs';

import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * Panel `/admin/operacje` (#47): wiersze = te same stany co `/api/health/ops`.
 *
 * Stan wiersza wynika wyłącznie z sygnałów `evaluateOps`/`backupAlerts` (panel nie liczy progów
 * drugi raz); każdy sygnał czujek ma swój wiersz (kontrola ujemna: sygnał bez wiersza = czerwony);
 * brak sekcji metryk = „brak danych”, nigdy „ok”; odczyt tylko po `requireAdmin` (nie-admin →
 * `notFound()` przed odczytem czujek).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
const readOpsStatus = vi.fn();
vi.mock('@/lib/ops/status', () => ({ readOpsStatus: () => readOpsStatus() }));

const healthy: OpsMetrics = {
  email: { ready: 2, oldestReadyAgeSeconds: 30, abandonedLeases: 0, failedLast24h: 0 },
  authEmail: { ready: 0, oldestReadyAgeSeconds: 0, abandonedLeases: 0, failedLast24h: 0 },
  webhooks: { stuckProcessing: 0, failedLast24h: 0 },
  maintenance: { overdueActiveJobs: 0, staleDiscountReservations: 0, staleCheckoutIntents: 0 },
  connections: { used: 5, max: 100, reserved: 3 },
  storageDeletion: { pending: 0, oldestPendingAgeSeconds: 0, deadLetters: 0 },
  mail: {
    sentLast24h: 200,
    hardBouncesLast24h: 0,
    complaintsLast24h: 0,
    sentBaseline7d: 1000,
    hardBouncesBaseline7d: 5,
    complaintsBaseline7d: 0,
    activeSuppressions: 3,
    newSuppressionsLast24h: 0,
  },
};
const budget: AiBudgetStatus = {
  day: { spentMicroUsd: 10, limitMicroUsd: 1_000_000 },
  month: { spentMicroUsd: 10, limitMicroUsd: 10_000_000 },
  staleReservations: 0,
};
const recentRun: MaintenanceRun = {
  finishedAt: '2026-09-26T08:00:00Z',
  ageSeconds: 600,
  ok: true,
  durationMs: 1200,
  failedTask: null,
};
const freshBackup: BackupFreshness = { status: 'ok', ageSeconds: 3600, lastBackupAt: '2026-09-26T03:00:00.000Z' };
const pool: AppPoolStats = { total: 2, idle: 2, waiting: 0, max: 10 };

function input(over: {
  metrics?: OpsMetrics;
  aiBudget?: AiBudgetStatus | null;
  run?: MaintenanceRun | null | undefined;
  backup?: BackupFreshness;
  appPool?: AppPoolStats | null;
} = {}): OpsDashboardInput {
  const metrics = over.metrics ?? healthy;
  const aiBudget = 'aiBudget' in over ? (over.aiBudget ?? null) : budget;
  const run = 'run' in over ? over.run : recentRun;
  const backup = over.backup ?? freshBackup;
  const appPool = 'appPool' in over ? (over.appPool ?? null) : pool;
  const evaluation = evaluateOps(metrics, appPool, aiBudget, run);
  return {
    alerts: [...evaluation.alerts, ...backupAlerts(backup)],
    warnings: evaluation.warnings,
    metrics,
    appPool,
    aiBudget,
    maintenanceRun: run,
    backup,
  };
}

const byId = (rows: OpsRow[], id: OpsRow['id']) => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`brak wiersza ${id}`);
  return row;
};

describe('mapowanie czujek na wiersze', () => {
  it('zdrowy stan: każdy wiersz ok, stan zbiorczy ok', () => {
    const data = input();
    const rows = buildOpsRows(data);
    expect(rows.filter((r) => r.state !== 'ok')).toEqual([]);
    expect(opsOverallState(data.alerts, data.warnings)).toBe('ok');
    expect(byId(rows, 'emailQueueAge')).toMatchObject({
      value: { kind: 'seconds', value: 30 },
      threshold: { kind: 'max', value: { kind: 'seconds', value: 900 } },
      note: { key: 'queueReady', ready: 2 },
    });
  });

  it.each([
    ['emailQueueAge', 'alert', { ...healthy, email: { ...healthy.email, oldestReadyAgeSeconds: 901 } }],
    ['emailLeases', 'alert', { ...healthy, email: { ...healthy.email, abandonedLeases: 1 } }],
    ['emailFailed', 'warning', { ...healthy, email: { ...healthy.email, failedLast24h: 4 } }],
    ['authQueueAge', 'alert', { ...healthy, authEmail: { ...healthy.authEmail!, oldestReadyAgeSeconds: 301 } }],
    ['authLeases', 'alert', { ...healthy, authEmail: { ...healthy.authEmail!, abandonedLeases: 2 } }],
    ['webhooksStuck', 'alert', { ...healthy, webhooks: { stuckProcessing: 1, failedLast24h: 0 } }],
    ['webhooksFailed', 'warning', { ...healthy, webhooks: { stuckProcessing: 0, failedLast24h: 1 } }],
    ['maintenanceLag', 'alert', { ...healthy, maintenance: { ...healthy.maintenance, overdueActiveJobs: 3 } }],
    ['storageAge', 'alert', { ...healthy, storageDeletion: { pending: 1, oldestPendingAgeSeconds: 90_000, deadLetters: 0 } }],
    ['storageDeadLetters', 'alert', { ...healthy, storageDeletion: { pending: 1, oldestPendingAgeSeconds: 10, deadLetters: 1 } }],
    ['mailBounceRate', 'alert', { ...healthy, mail: { ...healthy.mail!, hardBouncesLast24h: 11 } }],
    ['mailComplaintRate', 'alert', { ...healthy, mail: { ...healthy.mail!, complaintsLast24h: 1 } }],
    ['mailNewSuppressions', 'alert', { ...healthy, mail: { ...healthy.mail!, newSuppressionsLast24h: 21 } }],
    ['mailActiveSuppressions', 'warning', { ...healthy, mail: { ...healthy.mail!, activeSuppressions: 1001 } }],
    ['dbConnections', 'alert', { ...healthy, connections: { used: 80, max: 100, reserved: 3 } }],
  ] as const)('%s → %s (ten sam sygnał co /api/health/ops)', (id, state, metrics) => {
    const data = input({ metrics });
    const rows = buildOpsRows(data);
    expect(byId(rows, id).state).toBe(state);
    // Pozostałe wiersze zostają „ok” — sygnał nie przecieka do innych wierszy.
    expect(rows.filter((r) => r.id !== id && r.state !== 'ok').map((r) => r.id)).toEqual([]);
    expect(opsOverallState(data.alerts, data.warnings)).toBe(state);
  });

  it('stan każdego wiersza wynika z list alerts/warnings (panel nie liczy progów sam)', () => {
    const data = input({
      metrics: { ...healthy, email: { ...healthy.email, oldestReadyAgeSeconds: 5000, failedLast24h: 1 } },
    });
    // Te same metryki, ale bez sygnałów — wiersz musi być „ok”, bo stan pochodzi z czujek.
    const rows = buildOpsRows({ ...data, alerts: [], warnings: [] });
    expect(byId(rows, 'emailQueueAge').state).toBe('ok');
    expect(byId(buildOpsRows(data), 'emailQueueAge').state).toBe('alert');
  });

  it('za mała próba poczty: odsetek bez alarmu, uwaga z liczbą listów', () => {
    const rows = buildOpsRows(input({ metrics: { ...healthy, mail: { ...healthy.mail!, sentLast24h: 10, hardBouncesLast24h: 5 } } }));
    expect(byId(rows, 'mailBounceRate')).toMatchObject({
      state: 'ok',
      value: { kind: 'percent', value: 50 },
      note: { key: 'smallSample', sent: 10, min: 50 },
    });
  });

  it('brak sekcji (baza sprzed migracji) = „brak danych”, nigdy „ok”', () => {
    const metrics: OpsMetrics = { ...healthy, authEmail: null, mail: null };
    delete (metrics as Partial<OpsMetrics>).storageDeletion;
    const rows = buildOpsRows(input({ metrics, run: undefined, appPool: null }));
    for (const id of ['authQueueAge', 'authLeases', 'authFailed', 'mailBounceRate', 'mailComplaintRate',
      'mailNewSuppressions', 'mailActiveSuppressions', 'storageAge', 'storageDeadLetters', 'maintenanceLastRun',
      'appPoolWaiting'] as const) {
      expect(byId(rows, id), id).toMatchObject({ state: 'noData', value: { kind: 'none' } });
    }
  });

  it('budżet AI: nieczytelny = ostrzeżenie, wyczerpany dzień nie oznacza miesiąca', () => {
    const unknown = buildOpsRows(input({ aiBudget: null }));
    expect(byId(unknown, 'aiBudgetDay').state).toBe('warning');
    expect(byId(unknown, 'aiStaleReservations').state).toBe('noData');

    const rows = buildOpsRows(input({ aiBudget: { ...budget, day: { spentMicroUsd: 1_000_000, limitMicroUsd: 1_000_000 } } }));
    expect(byId(rows, 'aiBudgetDay')).toMatchObject({ state: 'alert', value: { kind: 'percent', value: 100 } });
    expect(byId(rows, 'aiBudgetMonth').state).toBe('ok');
  });

  it('ostatni przebieg maintenance: brak = ostrzeżenie, stary = alarm, błąd = ostrzeżenie z nazwą zadania', () => {
    const never = parseMaintenanceRun({ finishedAt: null, ageSeconds: null, ok: null, durationMs: null, failedTask: null });
    expect(never).not.toBeNull();
    expect(byId(buildOpsRows(input({ run: never })), 'maintenanceLastRun')).toMatchObject({
      state: 'warning',
      note: { key: 'lastRunNever' },
    });
    expect(byId(buildOpsRows(input({ run: { ...recentRun, ageSeconds: 7201 } })), 'maintenanceLastRun')).toMatchObject({
      state: 'alert',
      value: { kind: 'seconds', value: 7201 },
    });
    expect(byId(buildOpsRows(input({ run: { ...recentRun, ok: false, failedTask: 'jobExpiry' } })), 'maintenanceLastRun')).toMatchObject({
      state: 'warning',
      note: { key: 'lastRunFailed', task: 'jobExpiry' },
    });
    expect(byId(buildOpsRows(input({ run: null })), 'maintenanceLastRun')).toMatchObject({
      state: 'warning',
      note: { key: 'lastRunUnknown' },
    });
    // Nazwa zadania tylko jako stały identyfikator — inny tekst nie przechodzi walidacji.
    expect(parseMaintenanceRun({ ...recentRun, ok: false, failedTask: 'a@b.be' })).toBeNull();
  });

  it('kopia: brak konfiguracji = alarm bez wartości (nigdy „ok”)', () => {
    expect(byId(buildOpsRows(input({ backup: { status: 'unconfigured' } })), 'backupAge')).toMatchObject({
      state: 'alert',
      value: { kind: 'none' },
      note: { key: 'backupStatus', status: 'unconfigured' },
    });
  });

  it('każdy sygnał czujek ma wiersz w panelu (kontrola ujemna: nowy sygnał bez wiersza = czerwony)', () => {
    const src = (file: string) => readFileSync(join(process.cwd(), file), 'utf-8');
    const pushed = [...src('src/lib/ops/sensors.ts').matchAll(/(?:alerts|warnings)\.push\('([a-z_]+)'\)/g)].map((m) => m[1]);
    const backup = [...src('src/lib/ops/backup-freshness.ts').matchAll(/return \['(backup_[a-z_]+)'\]/g)].map((m) => m[1]);
    const signals = new Set([...pushed, ...backup]);
    expect(signals.size).toBeGreaterThan(20);
    const covered = new Set(buildOpsRows(input()).flatMap((r) => r.signals as readonly string[]));
    expect([...signals].filter((s) => !covered.has(s!))).toEqual([]);
    // Kontrola ujemna samego sprawdzenia: bez wiersza kolejki storage jego sygnały są wykrywane jako brak.
    const partial = new Set(buildOpsRows(input()).filter((r) => r.section !== 'storage').flatMap((r) => r.signals as readonly string[]));
    expect([...signals].filter((s) => !partial.has(s!))).toEqual(['storage_deletion_age', 'storage_deletion_dead_letter']);
  });

  it('wiersze nie niosą danych osobowych ani sekretów — same liczby i kody', () => {
    const text = JSON.stringify(buildOpsRows(demoOpsInput()));
    expect(text).not.toMatch(/@|https?:|postgres|secret|token/i);
  });
});

describe('getOpsDashboard — odczyt tylko dla admina', () => {
  beforeEach(() => {
    readOpsStatus.mockReset();
  });

  it('nie-admin → notFound PRZED odczytem czujek (kontrola ujemna)', async () => {
    const { getOpsDashboard } = await import('@/lib/data/admin-ops');
    for (const role of ['employer', 'candidate'] as const) {
      resetFakeDb({ id: '00000000-0000-4000-8000-00000000b001', role });
      await expect(getOpsDashboard()).rejects.toThrow('NEXT_NOT_FOUND');
    }
    resetFakeDb(null);
    await expect(getOpsDashboard()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(readOpsStatus).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('admin → wiersze z tego samego odczytu co /api/health/ops', async () => {
    resetFakeDb({ id: '00000000-0000-4000-8000-00000000a001', role: 'admin' });
    const data = input({ metrics: { ...healthy, webhooks: { stuckProcessing: 2, failedLast24h: 0 } } });
    readOpsStatus.mockResolvedValue({ kind: 'ok', status: 'alert', ...data });
    const { getOpsDashboard } = await import('@/lib/data/admin-ops');
    const result = await getOpsDashboard();
    expect(readOpsStatus).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok', demo: false, overall: 'alert', lastMaintenanceAt: recentRun.finishedAt });
    if (result.status !== 'ok') throw new Error('oczekiwano ok');
    expect(byId(result.rows, 'webhooksStuck').state).toBe('alert');
  });

  it('brak źródła / awaria odczytu → jawny stan, bez wierszy', async () => {
    resetFakeDb({ id: '00000000-0000-4000-8000-00000000a001', role: 'admin' });
    const { getOpsDashboard } = await import('@/lib/data/admin-ops');
    readOpsStatus.mockResolvedValue({ kind: 'unconfigured', backup: { status: 'unconfigured' } });
    await expect(getOpsDashboard()).resolves.toMatchObject({ status: 'unconfigured' });
    readOpsStatus.mockRejectedValue(new Error('boom'));
    await expect(getOpsDashboard()).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('tryb demo (bez bazy): przykładowy stan oznaczony, bez sprawdzania roli i bez odczytu', async () => {
    resetFakeDb(null);
    fakeSession.configured = false;
    const { getOpsDashboard } = await import('@/lib/data/admin-ops');
    const result = await getOpsDashboard();
    expect(result).toMatchObject({ status: 'ok', demo: true });
    expect(readOpsStatus).not.toHaveBeenCalled();
    if (result.status !== 'ok') throw new Error('oczekiwano ok');
    expect(byId(result.rows, 'maintenanceLastRun').state).toBe('warning');
  });
});
