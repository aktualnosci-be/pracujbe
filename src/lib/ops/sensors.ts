import { z } from 'zod/v3';

/**
 * Czujki operacyjne (#47). Baza zwraca same liczby (`public.ops_metrics()`, 0096);
 * tutaj — walidacja kształtu i progi alarmowe. Moduł jest czysty (bez I/O), więc
 * progi są testowane jednostkowo, a endpoint `/api/health/ops` tylko go wywołuje.
 *
 * `alerts` = stan wymagający reakcji (HTTP 503 — monitor podnosi alarm), `warnings` =
 * sygnał do przeglądu bez alarmu (HTTP 200). Powrót do `ok` = sygnał recovery.
 */

const count = z.number().int().nonnegative();

const queueSchema = z.object({
  ready: count,
  oldestReadyAgeSeconds: count,
  abandonedLeases: count,
  failedLast24h: count,
});

export const opsMetricsSchema = z.object({
  email: queueSchema,
  authEmail: queueSchema.nullable(),
  webhooks: z.object({ stuckProcessing: count, failedLast24h: count }),
  maintenance: z.object({
    overdueActiveJobs: count,
    staleDiscountReservations: count,
    staleCheckoutIntents: count,
  }),
  connections: z.object({ used: count, max: count, reserved: count }),
  // #44 (0111). Brak sekcji = baza sprzed migracji: czujki poczty milczą zamiast 503.
  mail: z.object({
    sentLast24h: count,
    hardBouncesLast24h: count,
    complaintsLast24h: count,
    sentBaseline7d: count,
    hardBouncesBaseline7d: count,
    complaintsBaseline7d: count,
    activeSuppressions: count,
    newSuppressionsLast24h: count,
  }).nullable().default(null),
});

export type OpsMetrics = z.infer<typeof opsMetricsSchema>;

export interface AppPoolStats {
  total: number;
  idle: number;
  waiting: number;
  max: number;
}

export const OPS_THRESHOLDS = {
  /** Worker e-mail co 5 min + dzierżawa 300 s: 15 min = co najmniej dwa pominięte przebiegi. */
  emailOldestReadySeconds: 15 * 60,
  /** E-maile auth (weryfikacja, reset hasła) — użytkownik czeka na nie od razu. */
  authEmailOldestReadySeconds: 5 * 60,
  /** Udział połączeń PostgreSQL dostępnych dla aplikacji (max − zarezerwowane). */
  connectionsRatio: 0.8,
  /** #44: poniżej tej liczby listów w oknie odsetek to szum (1 odbicie na 10 = 10%). */
  mailMinSample: 50,
  /** Odsetek trwałych odbić kohorty 24 h — ponad 5% dostawcy zaczynają ograniczać wysyłkę. */
  mailHardBounceRate: 0.05,
  /** Odsetek skarg kohorty 24 h — 0,3% to górna granica wytycznych dużych skrzynek. */
  mailComplaintRate: 0.003,
  /** Wzrost: odsetek 24 h > krotność odsetka z 7 dób bazowych i ponad dolny próg. */
  mailRateRiseFactor: 2,
  mailHardBounceRiseFloor: 0.02,
  mailComplaintRiseFloor: 0.001,
  /** Nowe blokady (trwałe odbicia + skargi) w 24 h — nagły skok = zła lista lub import. */
  mailNewSuppressions: 20,
  /** Aktywne blokady łącznie — sygnał do przeglądu listy, nie awaria. */
  mailActiveSuppressions: 1000,
} as const;

export type OpsSignal =
  | 'email_queue_age'
  | 'email_lease_abandoned'
  | 'email_failed'
  | 'auth_email_queue_age'
  | 'auth_email_lease_abandoned'
  | 'auth_email_failed'
  | 'webhook_stuck'
  | 'webhook_failed'
  | 'maintenance_lag'
  | 'db_connections'
  | 'app_pool_waiting'
  | 'mail_hard_bounce_rate'
  | 'mail_hard_bounce_rising'
  | 'mail_complaint_rate'
  | 'mail_complaint_rising'
  | 'mail_suppressions_new'
  | 'mail_suppressions_active';

export interface OpsEvaluation {
  status: 'ok' | 'alert';
  alerts: OpsSignal[];
  warnings: OpsSignal[];
}

export function parseOpsMetrics(raw: unknown): OpsMetrics | null {
  const parsed = opsMetricsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function evaluateOps(metrics: OpsMetrics, pool: AppPoolStats | null = null): OpsEvaluation {
  const alerts: OpsSignal[] = [];
  const warnings: OpsSignal[] = [];

  if (metrics.email.oldestReadyAgeSeconds > OPS_THRESHOLDS.emailOldestReadySeconds) alerts.push('email_queue_age');
  if (metrics.email.abandonedLeases > 0) alerts.push('email_lease_abandoned');
  if (metrics.email.failedLast24h > 0) warnings.push('email_failed');

  const auth = metrics.authEmail;
  if (auth) {
    if (auth.oldestReadyAgeSeconds > OPS_THRESHOLDS.authEmailOldestReadySeconds) alerts.push('auth_email_queue_age');
    if (auth.abandonedLeases > 0) alerts.push('auth_email_lease_abandoned');
    if (auth.failedLast24h > 0) warnings.push('auth_email_failed');
  }

  if (metrics.webhooks.stuckProcessing > 0) alerts.push('webhook_stuck');
  if (metrics.webhooks.failedLast24h > 0) warnings.push('webhook_failed');

  const m = metrics.maintenance;
  if (m.overdueActiveJobs > 0 || m.staleDiscountReservations > 0 || m.staleCheckoutIntents > 0) {
    alerts.push('maintenance_lag');
  }

  const available = metrics.connections.max - metrics.connections.reserved;
  if (available <= 0 || metrics.connections.used >= available * OPS_THRESHOLDS.connectionsRatio) {
    alerts.push('db_connections');
  }

  if (metrics.mail) evaluateMail(metrics.mail, alerts, warnings);

  // Żądania czekające na połączenie puli procesu = pula za mała albo zablokowane zapytania.
  if (pool && pool.waiting > 0) warnings.push('app_pool_waiting');

  return { status: alerts.length > 0 ? 'alert' : 'ok', alerts, warnings };
}

type MailMetrics = NonNullable<OpsMetrics['mail']>;

/**
 * #44: jakość doręczeń. Odsetek = zdarzenia kohorty / listy przyjęte przez dostawcę w oknie.
 * Za mała próba = brak oceny (ani alarmu, ani „wzrostu” z pojedynczego odbicia).
 */
function evaluateMail(mail: MailMetrics, alerts: OpsSignal[], warnings: OpsSignal[]): void {
  const t = OPS_THRESHOLDS;
  if (mail.sentLast24h >= t.mailMinSample) {
    const baselineOk = mail.sentBaseline7d >= t.mailMinSample;
    const rate = (events: number) => events / mail.sentLast24h;
    const baseline = (events: number) => events / mail.sentBaseline7d;
    const rising = (now: number, base: number, floor: number) =>
      baselineOk && now > floor && now > base * t.mailRateRiseFactor;

    const bounce = rate(mail.hardBouncesLast24h);
    if (bounce > t.mailHardBounceRate) alerts.push('mail_hard_bounce_rate');
    else if (rising(bounce, baseline(mail.hardBouncesBaseline7d), t.mailHardBounceRiseFloor)) {
      alerts.push('mail_hard_bounce_rising');
    }

    const complaint = rate(mail.complaintsLast24h);
    if (complaint > t.mailComplaintRate) alerts.push('mail_complaint_rate');
    else if (rising(complaint, baseline(mail.complaintsBaseline7d), t.mailComplaintRiseFloor)) {
      alerts.push('mail_complaint_rising');
    }
  }
  if (mail.newSuppressionsLast24h > t.mailNewSuppressions) alerts.push('mail_suppressions_new');
  if (mail.activeSuppressions > t.mailActiveSuppressions) warnings.push('mail_suppressions_active');
}
