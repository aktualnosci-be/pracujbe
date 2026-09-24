'use server';

import { z } from 'zod/v3';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Usunięcie konta kandydata (#486).
 *
 * Jedno RPC `request_account_erasure` (SECURITY DEFINER, 0105): rola kandydata, potwierdzenie
 * adresem e-mail konta (porównanie w bazie, bez rozróżniania wielkości liter), w tej samej
 * transakcji usunięcie danych procesu, profilu i konta auth, tombstone i ślad wniosku. Obiekty
 * storage idą do kolejki (`storage_deletion_queue`), którą opróżnia `/api/maintenance`.
 * Po sukcesie sesja jest zamykana — konto już nie istnieje.
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
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('JWT')) return 'denied';
  return 'failed';
}

export async function deleteMyAccountAction(confirmEmail: unknown): Promise<DeleteAccountResult> {
  const parsed = confirmSchema.safeParse(confirmEmail);
  if (!parsed.success) return { ok: false, error: 'mismatch' };
  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { error } = await supabase.rpc('request_account_erasure', { p_confirm_email: parsed.data });
    if (error) {
      const code = mapPgError(error.message);
      if (code === 'failed') captureError(error, { area: 'account-data.deleteMyAccountAction' });
      return { ok: false, error: code };
    }
    await supabase.auth.signOut().catch(() => undefined);
    return { ok: true };
  } catch (error) {
    captureError(error, { area: 'account-data.deleteMyAccountAction' });
    return { ok: false, error: 'failed' };
  }
}
