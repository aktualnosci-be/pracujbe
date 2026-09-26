/**
 * Kampanie e-mail w panelu administratora (#45, `/admin/kampanie`) — czyste reguły, bez DB.
 *
 *   - statusy rewizji (`email_campaigns.status`, 0101) i filtr listy,
 *   - dozwolone akcje admina (lustro macierzy w RPC `admin_*_email_campaign`, 0111),
 *   - statusy odbiorców (`email_campaign_recipients.status`) — w panelu same liczby,
 *   - gotowość wysyłki marketingu: jawny nadawca (`marketingSenderFromEnv`) i sekret linku
 *     wypisania. Bez kompletu worker i tak nie wyśle listu marketingowego (`renderDelivery`),
 *     więc panel nie pozwala aktywować rewizji, a `/api/maintenance` nie kolejkuje odbiorców.
 *   - podgląd treści rewizji w każdym języku serwisu (kształt jak w payloadzie workera).
 */

import { marketingSenderFromEnv } from '@/lib/email/sender';
import { UNSUBSCRIBE_SECRET_MIN_LENGTH } from '@/lib/email/unsubscribe-token';

/* ---------------------------------------------------------------------------
 * Statusy rewizji i filtr listy
 * ------------------------------------------------------------------------- */

export const CAMPAIGN_STATUSES = ['draft', 'active', 'completed', 'superseded', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/** Status → klucz i18n (namespace `admin`). */
export const CAMPAIGN_STATUS_KEY: Record<CampaignStatus, string> = {
  draft: 'campaignStatusDraft',
  active: 'campaignStatusActive',
  completed: 'campaignStatusCompleted',
  superseded: 'campaignStatusSuperseded',
  cancelled: 'campaignStatusCancelled',
};

/** Filtr listy: domyślnie wszystkie; „zamknięte” = zakończone, zastąpione i zatrzymane. */
export const CAMPAIGN_FILTERS = ['all', 'draft', 'active', 'closed'] as const;
export type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];

export function parseCampaignFilter(raw: string | undefined | null): CampaignFilter {
  return raw && (CAMPAIGN_FILTERS as readonly string[]).includes(raw) ? (raw as CampaignFilter) : 'all';
}

/** Statusy dla filtra (null = bez ograniczenia). */
export function campaignStatusesFor(filter: CampaignFilter): CampaignStatus[] | null {
  if (filter === 'all') return null;
  if (filter === 'closed') return ['completed', 'superseded', 'cancelled'];
  return [filter];
}

/* ---------------------------------------------------------------------------
 * Akcje (lustro RPC 0111)
 * ------------------------------------------------------------------------- */

/** Aktywować można tylko szkic (`admin_activate_email_campaign`). */
export function canActivateCampaign(status: string): boolean {
  return status === 'draft';
}

/** Zatrzymać można szkic, aktywną albo zakończoną rewizję (`admin_cancel_email_campaign`). */
export function canCancelCampaign(status: string): boolean {
  return status === 'draft' || status === 'active' || status === 'completed';
}

/* ---------------------------------------------------------------------------
 * Odbiorcy — same liczby (bez adresów i treści)
 * ------------------------------------------------------------------------- */

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'reserved',
  'queued',
  'accepted',
  'delivered',
  'skipped_consent',
  'failed',
  'cancelled',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_KEY: Record<CampaignRecipientStatus, string> = {
  reserved: 'campaignRecipientReserved',
  queued: 'campaignRecipientQueued',
  accepted: 'campaignRecipientAccepted',
  delivered: 'campaignRecipientDelivered',
  skipped_consent: 'campaignRecipientSkippedConsent',
  failed: 'campaignRecipientFailed',
  cancelled: 'campaignRecipientCancelled',
};

export type CampaignRecipientStats = Record<CampaignRecipientStatus, number> & { total: number };

export function emptyRecipientStats(): CampaignRecipientStats {
  return {
    reserved: 0,
    queued: 0,
    accepted: 0,
    delivered: 0,
    skipped_consent: 0,
    failed: 0,
    cancelled: 0,
    total: 0,
  };
}

/** Wiersze `status, n` (GROUP BY) → komplet liczników; nieznany status liczy się tylko do sumy. */
export function recipientStatsOf(rows: Array<{ status: unknown; n: unknown }>): CampaignRecipientStats {
  const stats = emptyRecipientStats();
  for (const row of rows) {
    const n = typeof row.n === 'number' ? row.n : Number(row.n);
    if (!Number.isFinite(n) || n < 0) continue;
    stats.total += n;
    if (typeof row.status === 'string' && (CAMPAIGN_RECIPIENT_STATUSES as readonly string[]).includes(row.status)) {
      stats[row.status as CampaignRecipientStatus] += n;
    }
  }
  return stats;
}

/* ---------------------------------------------------------------------------
 * Gotowość wysyłki marketingu
 * ------------------------------------------------------------------------- */

/**
 * Komplet konfiguracji do wysyłki listu marketingowego: `EMAIL_FROM`, `EMAIL_SENDER_IDENTITY`,
 * `EMAIL_SENDER_POSTAL_ADDRESS` (`marketingSenderFromEnv`) i `EMAIL_UNSUBSCRIBE_SECRET`
 * (link wypisania — bez niego worker nie wyśle marketingu). Wartości nigdy nie trafiają do UI.
 */
export function campaignSendingReady(
  source: Record<string, string | undefined> = process.env,
): boolean {
  const secret = source.EMAIL_UNSUBSCRIBE_SECRET;
  return (
    marketingSenderFromEnv(source) !== null &&
    typeof secret === 'string' &&
    secret.length >= UNSUBSCRIBE_SECRET_MIN_LENGTH
  );
}

/* ---------------------------------------------------------------------------
 * Podgląd treści — czysty moduł (także edytor w przeglądarce), tu re-eksport.
 * ------------------------------------------------------------------------- */

export { campaignPreview, type CampaignLocalePreview } from '@/lib/admin/campaign-preview';
