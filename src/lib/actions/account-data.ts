'use server';

import { z } from 'zod/v3';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/sentry';

/**
 * Usunięcie konta kandydata (#486).
 *
 * Jedno RPC `request_account_erasure` (SECURITY DEFINER, 0105): rola kandydata, potwierdzenie
 * adresem e-mail konta (porównanie w bazie, bez rozróżniania wielkości liter), w tej samej
 * transakcji usunięcie danych procesu, profilu i konta auth, tombstone i ślad wniosku. Obiekty
 * storage idą do kolejki (`storage_deletion_queue`), którą opróżnia `/api/maintenance`.
 * Sesje Better Auth (`auth.session`, `on delete cascade` z `auth.users`, 0057) znikają w tej
 * samej transakcji — konto i jego sesje przestają istnieć razem (#25: wywołanie pod sesją
 * przez `withPortalTransaction`).
 *
 * Tryb demo (bez env): walidacja adresu bez zapisu (`demo: true`). Błędy → kod użytkowy
 * (Invariant #8): `mismatch` (inny adres), `denied` (brak sesji / konto nie-kandydata),
 * `failed` (reszta; technikalia do Sentry).
 */

const confirmSchema = z.string().trim().email().max(320);

export type DeleteAccountError = 'mismatch' | 'denied' | 'failed';
export type DeleteAccountResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: DeleteAccountError };

function mapPgError(message: string | undefined): DeleteAccountError {
  const m = message ?? '';
  if (m.includes('CONFIRMATION_MISMATCH')) return 'mismatch';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED')) return 'denied';
  return 'failed';
}

export async function deleteMyAccountAction(confirmEmail: unknown): Promise<DeleteAccountResult> {
  const parsed = confirmSchema.safeParse(confirmEmail);
  if (!parsed.success) return { ok: false, error: 'mismatch' };
  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'denied' };
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'request_account_erasure', { p_confirm_email: parsed.data }));
    return { ok: true };
  } catch (error) {
    const code = isDatabaseError(error) ? mapPgError(databaseErrorMessage(error)) : 'failed';
    if (code === 'failed') captureError(error, { area: 'account-data.deleteMyAccountAction' });
    return { ok: false, error: code };
  }
}
