import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateOps, OPS_THRESHOLDS, opsMetricsSchema, parseOpsMetrics, type OpsMetrics } from '@/lib/ops/sensors';

function healthy(): OpsMetrics {
  return {
    email: { ready: 3, oldestReadyAgeSeconds: 60, abandonedLeases: 0, failedLast24h: 0 },
    authEmail: { ready: 0, oldestReadyAgeSeconds: 0, abandonedLeases: 0, failedLast24h: 0 },
    webhooks: { stuckProcessing: 0, failedLast24h: 0 },
    maintenance: { overdueActiveJobs: 0, staleDiscountReservations: 0, staleCheckoutIntents: 0 },
    connections: { used: 10, max: 100, reserved: 3 },
  };
}

describe('Czujki operacyjne (#47)', () => {
  it('zdrowy stan = ok bez sygnałów (sygnał recovery)', () => {
    expect(evaluateOps(healthy())).toEqual({ status: 'ok', alerts: [], warnings: [] });
  });

  it('wiek najstarszego gotowego e-maila powyżej progu = alarm, na progu jeszcze nie', () => {
    const m = healthy();
    m.email.oldestReadyAgeSeconds = OPS_THRESHOLDS.emailOldestReadySeconds;
    expect(evaluateOps(m).alerts).toEqual([]);
    m.email.oldestReadyAgeSeconds += 1;
    expect(evaluateOps(m)).toMatchObject({ status: 'alert', alerts: ['email_queue_age'] });
  });

  it('kolejka auth ma ostrzejszy próg niż domenowa', () => {
    const m = healthy();
    m.authEmail!.oldestReadyAgeSeconds = OPS_THRESHOLDS.authEmailOldestReadySeconds + 1;
    expect(evaluateOps(m).alerts).toEqual(['auth_email_queue_age']);
  });

  it('porzucone dzierżawy, zawieszony webhook i opóźnione maintenance = alarmy', () => {
    const m = healthy();
    m.email.abandonedLeases = 1;
    m.authEmail!.abandonedLeases = 2;
    m.webhooks.stuckProcessing = 1;
    m.maintenance.staleCheckoutIntents = 1;
    expect(evaluateOps(m).alerts).toEqual([
      'email_lease_abandoned', 'auth_email_lease_abandoned', 'webhook_stuck', 'maintenance_lag',
    ]);
  });

  it.each([
    ['overdueActiveJobs'], ['staleDiscountReservations'], ['staleCheckoutIntents'],
  ] as const)('maintenance_lag z %s', (key) => {
    const m = healthy();
    m.maintenance[key] = 1;
    expect(evaluateOps(m).alerts).toEqual(['maintenance_lag']);
  });

  it('nieudane wysyłki i webhooki = ostrzeżenia bez alarmu', () => {
    const m = healthy();
    m.email.failedLast24h = 2;
    m.authEmail!.failedLast24h = 1;
    m.webhooks.failedLast24h = 1;
    expect(evaluateOps(m)).toEqual({
      status: 'ok', alerts: [], warnings: ['email_failed', 'auth_email_failed', 'webhook_failed'],
    });
  });

  it('połączenia: próg liczony od puli bez połączeń zarezerwowanych', () => {
    const m = healthy();
    m.connections = { used: 77, max: 100, reserved: 3 }; // 77 < 0.8 * 97 = 77.6
    expect(evaluateOps(m).alerts).toEqual([]);
    m.connections.used = 78;
    expect(evaluateOps(m).alerts).toEqual(['db_connections']);
    m.connections = { used: 0, max: 3, reserved: 3 };
    expect(evaluateOps(m).alerts).toEqual(['db_connections']);
  });

  it('czekające żądania puli procesu = ostrzeżenie', () => {
    expect(evaluateOps(healthy(), { total: 5, idle: 0, waiting: 2, max: 5 }).warnings).toEqual(['app_pool_waiting']);
    expect(evaluateOps(healthy(), { total: 5, idle: 0, waiting: 0, max: 5 }).warnings).toEqual([]);
  });

  it('brak kolejki auth (ścieżka Supabase) nie jest błędem', () => {
    const m = { ...healthy(), authEmail: null };
    expect(parseOpsMetrics(m)).toEqual(m);
    expect(evaluateOps(m).status).toBe('ok');
  });

  it('odrzuca nieoczekiwany kształt (np. tekst, liczby ujemne, brak sekcji)', () => {
    expect(parseOpsMetrics(null)).toBeNull();
    expect(parseOpsMetrics('ok')).toBeNull();
    expect(parseOpsMetrics({ ...healthy(), webhooks: undefined })).toBeNull();
    const negative = healthy();
    negative.email.ready = -1;
    expect(parseOpsMetrics(negative)).toBeNull();
  });

  it('klucze schematu zgadzają się z najnowszym ops_metrics() z migracji (0096 → 0129)', () => {
    const dir = resolve(__dirname, '../../supabase/migrations');
    const latest = readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort()
      .filter((f) => readFileSync(resolve(dir, f), 'utf8').includes('create or replace function public.ops_metrics()'))
      .at(-1);
    expect(latest).toBeDefined();
    const sql = readFileSync(resolve(dir, latest!), 'utf8');
    const keys = new Set<string>();
    const collect = (shape: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(shape)) {
        keys.add(key);
        let inner = value as { shape?: Record<string, unknown>; unwrap?: () => { shape?: Record<string, unknown> } };
        if (!inner.shape && typeof inner.unwrap === 'function') inner = inner.unwrap();
        if (inner.shape) collect(inner.shape);
      }
    };
    collect(opsMetricsSchema.shape);
    for (const key of keys) expect(sql, key).toContain(`'${key}'`);
  });

  it('#574: obiekt storage czeka > 24 h albo dead-letter = alarm; bez sekcji (baza sprzed 0129) = ok', () => {
    const m: OpsMetrics = { ...healthy(), storageDeletion: { pending: 2, oldestPendingAgeSeconds: 60, deadLetters: 0 } };
    expect(evaluateOps(m)).toEqual({ status: 'ok', alerts: [], warnings: [] });
    m.storageDeletion!.oldestPendingAgeSeconds = OPS_THRESHOLDS.storageDeletionOldestSeconds;
    expect(evaluateOps(m).alerts).toEqual([]);
    m.storageDeletion!.oldestPendingAgeSeconds += 1;
    expect(evaluateOps(m).alerts).toEqual(['storage_deletion_age']);
    m.storageDeletion = { pending: 0, oldestPendingAgeSeconds: 0, deadLetters: 1 };
    expect(evaluateOps(m)).toMatchObject({ status: 'alert', alerts: ['storage_deletion_dead_letter'] });
    expect(parseOpsMetrics(healthy())).not.toBeNull();
    expect(parseOpsMetrics({ ...healthy(), storageDeletion: { pending: -1, oldestPendingAgeSeconds: 0, deadLetters: 0 } }))
      .toBeNull();
  });
});
