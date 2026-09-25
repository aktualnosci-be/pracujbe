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
    mail: {
      sentLast24h: 1000, hardBouncesLast24h: 5, complaintsLast24h: 0,
      sentBaseline7d: 7000, hardBouncesBaseline7d: 35, complaintsBaseline7d: 1,
      activeSuppressions: 40, newSuppressionsLast24h: 5,
    },
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

  it('klucze schematu zgadzają się z najnowszą definicją ops_metrics() w migracjach', () => {
    const dir = resolve(__dirname, '../../supabase/migrations');
    const latest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .filter((f) => readFileSync(resolve(dir, f), 'utf8').includes('create or replace function public.ops_metrics()'))
      .at(-1)!;
    expect(latest).not.toBe('0096_ops_metrics.sql');
    const sql = readFileSync(resolve(dir, latest), 'utf8');
    const keys = new Set<string>();
    type Node = { shape?: Record<string, unknown>; unwrap?: () => Node; _def?: { innerType?: Node } };
    const inner = (node: Node): Node => {
      if (node.shape) return node;
      if (node._def?.innerType) return inner(node._def.innerType);
      if (typeof node.unwrap === 'function') return inner(node.unwrap());
      return node;
    };
    const collect = (shape: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(shape)) {
        keys.add(key);
        const node = inner(value as Node);
        if (node.shape) collect(node.shape);
      }
    };
    collect(opsMetricsSchema.shape);
    expect(keys.has('newSuppressionsLast24h')).toBe(true);
    for (const key of keys) expect(sql, key).toContain(`'${key}'`);
  });
});

describe('Czujki poczty (#44)', () => {
  const mail = (patch: Partial<NonNullable<OpsMetrics['mail']>>): OpsMetrics => {
    const m = healthy();
    m.mail = { ...m.mail!, ...patch };
    return m;
  };

  it('baza sprzed 0108 (brak sekcji mail) = czujki poczty milczą, bez 503', () => {
    const { mail: _omit, ...legacy } = healthy();
    const parsed = parseOpsMetrics(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.mail).toBeNull();
    expect(evaluateOps(parsed!)).toEqual({ status: 'ok', alerts: [], warnings: [] });
  });

  it('odsetek trwałych odbić powyżej progu = alarm, na progu jeszcze nie', () => {
    const atLimit = Math.round(1000 * OPS_THRESHOLDS.mailHardBounceRate);
    expect(evaluateOps(mail({ hardBouncesLast24h: atLimit, hardBouncesBaseline7d: 7000 * 0.05 })).alerts).toEqual([]);
    expect(evaluateOps(mail({ hardBouncesLast24h: atLimit + 1 }))).toMatchObject({
      status: 'alert', alerts: ['mail_hard_bounce_rate'],
    });
  });

  it('odsetek skarg powyżej 0,3% = alarm', () => {
    expect(evaluateOps(mail({ complaintsLast24h: 3, complaintsBaseline7d: 21 })).alerts).toEqual([]);
    expect(evaluateOps(mail({ complaintsLast24h: 4 })).alerts).toEqual(['mail_complaint_rate']);
  });

  it('wzrost odsetka względem 7 dób (poniżej progu bezwzględnego) = alarm wzrostu', () => {
    // 3% dziś vs 0,5% w bazie — ponad 2× i ponad dolny próg 2%.
    expect(evaluateOps(mail({ hardBouncesLast24h: 30 })).alerts).toEqual(['mail_hard_bounce_rising']);
    // 0,2% dziś vs 0,014% w bazie — ponad 2× i ponad dolny próg 0,1%.
    expect(evaluateOps(mail({ complaintsLast24h: 2 })).alerts).toEqual(['mail_complaint_rising']);
  });

  it('bez wzrostu: odsetek poniżej dolnego progu albo nie więcej niż 2× bazy', () => {
    // 1,5% < dolny próg 2% mimo 3× bazy.
    expect(evaluateOps(mail({ hardBouncesLast24h: 15 })).alerts).toEqual([]);
    // 3% przy bazie 2% (< 2×).
    expect(evaluateOps(mail({ hardBouncesLast24h: 30, hardBouncesBaseline7d: 140 })).alerts).toEqual([]);
  });

  it('za mała próba = brak oceny odsetków (kontrola: pojedyncze odbicie nie alarmuje)', () => {
    const small = mail({ sentLast24h: OPS_THRESHOLDS.mailMinSample - 1, hardBouncesLast24h: 20, complaintsLast24h: 5 });
    expect(evaluateOps(small).alerts).toEqual([]);
    // Ta sama liczba zdarzeń przy wystarczającej próbie już alarmuje.
    const enough = mail({ sentLast24h: OPS_THRESHOLDS.mailMinSample, hardBouncesLast24h: 20, complaintsLast24h: 5 });
    expect(evaluateOps(enough).alerts).toEqual(['mail_hard_bounce_rate', 'mail_complaint_rate']);
  });

  it('bez bazy (mało listów w 7 dobach) wzrostu nie liczymy, próg bezwzględny działa', () => {
    const m = mail({ sentBaseline7d: 10, hardBouncesBaseline7d: 0, hardBouncesLast24h: 30 });
    expect(evaluateOps(m).alerts).toEqual([]);
    m.mail!.hardBouncesLast24h = 60;
    expect(evaluateOps(m).alerts).toEqual(['mail_hard_bounce_rate']);
  });

  it('skok nowych blokad = alarm, dużo aktywnych blokad = ostrzeżenie', () => {
    expect(evaluateOps(mail({ newSuppressionsLast24h: OPS_THRESHOLDS.mailNewSuppressions })).alerts).toEqual([]);
    expect(evaluateOps(mail({ newSuppressionsLast24h: OPS_THRESHOLDS.mailNewSuppressions + 1 })).alerts)
      .toEqual(['mail_suppressions_new']);
    expect(evaluateOps(mail({ activeSuppressions: OPS_THRESHOLDS.mailActiveSuppressions + 1 }))).toEqual({
      status: 'ok', alerts: [], warnings: ['mail_suppressions_active'],
    });
  });

  it('powrót poniżej progów = ok (recovery)', () => {
    const m = mail({ hardBouncesLast24h: 80, newSuppressionsLast24h: 90 });
    expect(evaluateOps(m).status).toBe('alert');
    m.mail = healthy().mail;
    expect(evaluateOps(m)).toEqual({ status: 'ok', alerts: [], warnings: [] });
  });
});
