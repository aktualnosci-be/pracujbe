import 'server-only';

import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { verifyAlertOffToken } from '@/lib/email/saved-search-alert-token';
import { unsubscribeSecretFromEnv } from '@/lib/email/unsubscribe-token';
import { captureError } from '@/lib/sentry';

/**
 * Wyłączenie jednego alertu zapisanego wyszukiwania z linku w e-mailu `jobMatch` (#100).
 *
 * Upoważnieniem jest wyłącznie podpisany token (bez sesji). Zapis przez RPC
 * `saved_search_alert_unsubscribe` (0114, tylko service_role) — idempotentny; cudze albo
 * usunięte wyszukiwanie kończy się tym samym „done" (wynik nie zdradza stanu konta).
 * Zakolejkowane już digesty tego alertu nie wyjdą: worker sprawdza alert przy claimie
 * i tuż przed wysyłką (`email_delivery_send_check`).
 */

export type AlertOffOutcome = { status: 'done' | 'invalid' | 'expired' | 'unavailable' | 'error' };

/** Sama weryfikacja podpisu (bez zapisu) — strona wyświetlana przez GET niczego nie zmienia. */
export function inspectAlertOffToken(token: unknown): { status: 'valid' | 'invalid' | 'expired' | 'unavailable' } {
  const secret = unsubscribeSecretFromEnv();
  if (!secret) return { status: 'unavailable' };
  const result = verifyAlertOffToken(token, secret);
  if (result.ok) return { status: 'valid' };
  return { status: result.reason === 'expired' ? 'expired' : 'invalid' };
}

export async function applyAlertOff(token: unknown): Promise<AlertOffOutcome> {
  const secret = unsubscribeSecretFromEnv();
  if (!secret) return { status: 'unavailable' };
  const verified = verifyAlertOffToken(token, secret);
  if (!verified.ok) return { status: verified.reason === 'expired' ? 'expired' : 'invalid' };
  if (!isServiceDatabaseConfigured()) return { status: 'unavailable' };

  try {
    await withServiceRole((tx) =>
      rpc(tx, 'saved_search_alert_unsubscribe', {
        p_profile_id: verified.profileId,
        p_saved_search_id: verified.savedSearchId,
      }),
    );
  } catch (err) {
    captureError(err, { area: 'email.alertOff' });
    return { status: 'error' };
  }
  return { status: 'done' };
}
