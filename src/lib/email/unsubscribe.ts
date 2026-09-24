import 'server-only';

import type { EmailPreferenceCategory } from '@/lib/email/categories';
import { unsubscribeSecretFromEnv, verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Wypisanie z kategorii e-maili na podstawie podpisanego tokenu (#45).
 *
 * Wspólne dla one-click POST (`/api/email/unsubscribe`, RFC 8058) i strony `/wypisz`.
 * Zapis przez RPC `email_unsubscribe` (0087, tylko service_role) — idempotentny: ponowienie
 * tego samego tokenu kończy się tym samym stanem. Worker ponownie sprawdza zgodę przy
 * claimie, więc wiadomości już zakolejkowane w tej kategorii nie wyjdą.
 */

export type UnsubscribeOutcome =
  | { status: 'done'; category: EmailPreferenceCategory }
  | { status: 'invalid' | 'expired' | 'unavailable' | 'error' };

/** Sama weryfikacja (bez zapisu) — dla strony potwierdzenia wyświetlanej przez GET. */
export function inspectUnsubscribeToken(
  token: unknown,
):
  | { status: 'valid'; category: EmailPreferenceCategory }
  | { status: 'invalid' | 'expired' | 'unavailable' } {
  const secret = unsubscribeSecretFromEnv();
  if (!secret) return { status: 'unavailable' };
  const result = verifyUnsubscribeToken(token, secret);
  if (result.ok) return { status: 'valid', category: result.category };
  return { status: result.reason === 'expired' ? 'expired' : 'invalid' };
}

export async function applyUnsubscribe(token: unknown): Promise<UnsubscribeOutcome> {
  const secret = unsubscribeSecretFromEnv();
  if (!secret) return { status: 'unavailable' };
  const verified = verifyUnsubscribeToken(token, secret);
  if (!verified.ok) return { status: verified.reason === 'expired' ? 'expired' : 'invalid' };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 'unavailable' };
  }

  try {
    const { error } = await createAdminClient().rpc('email_unsubscribe', {
      p_profile_id: verified.profileId,
      p_category: verified.category,
    });
    if (error) {
      captureError(error, { area: 'email.unsubscribe' });
      return { status: 'error' };
    }
  } catch (err) {
    captureError(err, { area: 'email.unsubscribe' });
    return { status: 'error' };
  }
  // Nieistniejący profil też kończy się „done": wynik nie zdradza stanu konta.
  return { status: 'done', category: verified.category };
}
