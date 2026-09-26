'use server';

import { z } from 'zod/v3';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

/**
 * Usunięcie konta kandydata albo pracodawcy (#486).
 *
 * Jedno RPC `request_account_erasure` (SECURITY DEFINER, 0105): rola kandydata, potwierdzenie
 * adresem e-mail konta (porównanie w bazie, bez rozróżniania wielkości liter), w tej samej
 * transakcji usunięcie danych procesu, profilu i konta auth, tombstone i ślad wniosku. Obiekty
 * storage idą do kolejki (`storage_deletion_queue`), którą opróżnia `/api/maintenance`.
 * Sesje Better Auth (`auth.session`, `on delete cascade` z `auth.users`, 0057) znikają w tej
 * samej transakcji — konto i jego sesje przestają istnieć razem (#25: wywołanie pod sesją
 * przez `withPortalTransaction`).
 *
 * Pracodawca (0209): `request_employer_account_erasure` — to samo potwierdzenie adresem;
 * ostatni aktywny właściciel firmy dostaje `COMPANY_LAST_OWNER` → `lastOwner` (najpierw
 * przekazanie roli albo zamknięcie firmy). Członkostwa znikają, dane firmy zostają, dziennik
 * audytu zostaje z aktorem = null.
 *
 * Tryb demo (bez env): walidacja adresu bez zapisu (`demo: true`). Błędy → kod użytkowy
 * (Invariant #8): `mismatch` (inny adres), `denied` (brak sesji / konto bez tej ścieżki),
 * `lastOwner` (ostatni właściciel firmy),
 * `failed` (reszta; technikalia do kanału błędów).
 */

const confirmSchema = z.string().trim().email().max(320);

export type DeleteAccountError = 'mismatch' | 'denied' | 'lastOwner' | 'failed';
export type DeleteAccountResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: DeleteAccountError };

function mapPgError(message: string | undefined): DeleteAccountError {
  const m = message ?? '';
  if (m.includes('CONFIRMATION_MISMATCH')) return 'mismatch';
  if (m.includes('COMPANY_LAST_OWNER')) return 'lastOwner';
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
    const fn = me.role === 'employer' ? 'request_employer_account_erasure' : 'request_account_erasure';
    await withPortalTransaction(me, (tx) => rpc(tx, fn, { p_confirm_email: parsed.data }));
    return { ok: true };
  } catch (error) {
    const code = isDatabaseError(error) ? mapPgError(databaseErrorMessage(error)) : 'failed';
    if (code === 'failed') captureError(error, { area: 'account-data.deleteMyAccountAction' });
    return { ok: false, error: code };
  }
}
