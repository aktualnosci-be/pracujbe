'use server';

import { campaignSendingReady, isCampaignStatus } from '@/lib/admin/campaigns';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Server Actions panelu kampanii e-mail (#45, `/admin/kampanie`).
 *
 *   - `activateEmailCampaign` — aktywuje szkic rewizji przez `admin_activate_email_campaign`
 *     (0109: is_admin(), CAS statusu, audyt). NIE wysyła niczego sama — odbiorców kolejkuje
 *     harmonogram. Bez kompletu konfiguracji nadawcy marketingu (`campaignSendingReady`)
 *     odmawia PRZED wywołaniem bazy (`reason: 'senderMissing'`).
 *   - `cancelEmailCampaign` — zatrzymuje rewizję przez `admin_cancel_email_campaign`
 *     (niezadzierżawione listy wygaszone; nieodwracalne). Działa także bez nadawcy.
 *
 * Zapis pod SESJĄ admina (`withPortalTransaction`, `auth.uid()` = admin), bo RPC sprawdzają
 * `is_admin()`. Błędy bazy → stabilny `ErrorCode` (Invariant #8). Bez env → DEMO.
 */

export type CampaignActionResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode; reason?: 'senderMissing' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapPgError(message: string): ErrorCode {
  if (message.includes('STALE_STATE')) return 'STALE_STATE';
  if (message.includes('INVALID_TRANSITION')) return 'INVALID_TRANSITION';
  if (message.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (message.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

async function callCampaignRpc(
  fn: 'admin_activate_email_campaign' | 'admin_cancel_email_campaign',
  campaignId: string,
  expectedStatus: string,
  area: string,
): Promise<CampaignActionResult> {
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    try {
      await withPortalTransaction(me, (tx) =>
        rpc(tx, fn, { p_campaign_id: campaignId, p_expected_status: expectedStatus }),
      );
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
      throw error;
    }
    return { ok: true };
  } catch (error) {
    captureError(error, { area });
    return { ok: false, error: 'INTERNAL' };
  }
}

function validInput(campaignId: unknown, expectedStatus: unknown): boolean {
  return typeof campaignId === 'string' && UUID_RE.test(campaignId) && isCampaignStatus(expectedStatus);
}

/** Aktywuje szkic rewizji (tylko admin — egzekwowane w RPC). */
export async function activateEmailCampaign(
  campaignId: string,
  expectedStatus: string,
): Promise<CampaignActionResult> {
  // Bez nadawcy list marketingowy i tak nie wyjdzie — nie aktywujemy rewizji, która
  // zarezerwowałaby odbiorców bez możliwości wysyłki. Dotyczy też trybu demo.
  if (!campaignSendingReady()) {
    return { ok: false, error: 'VALIDATION_FAILED', reason: 'senderMissing' };
  }
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (!validInput(campaignId, expectedStatus)) return { ok: false, error: 'VALIDATION_FAILED' };
  return callCampaignRpc('admin_activate_email_campaign', campaignId, expectedStatus, 'admin.activateEmailCampaign');
}

/** Zatrzymuje rewizję (szkic, aktywną albo zakończoną). */
export async function cancelEmailCampaign(
  campaignId: string,
  expectedStatus: string,
): Promise<CampaignActionResult> {
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (!validInput(campaignId, expectedStatus)) return { ok: false, error: 'VALIDATION_FAILED' };
  return callCampaignRpc('admin_cancel_email_campaign', campaignId, expectedStatus, 'admin.cancelEmailCampaign');
}
