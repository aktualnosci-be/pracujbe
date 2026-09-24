import 'server-only';

import { isLocale } from '@/i18n/routing';
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
 * #45, etap 2 (0101): RPC zapisuje dowód wycofania zgody (źródło, język); strona pozwala też
 * wypisać się ze wszystkich kategorii jednym zapisem (`email_unsubscribe_all`).
 */

export type UnsubscribeOutcome =
  | { status: 'done'; category: EmailPreferenceCategory; scope?: 'all' }
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

export interface UnsubscribeOptions {
  /** Skąd przyszło wypisanie — trafia do dowodu zgody (0101). */
  source: 'unsubscribe_page' | 'one_click';
  /** Język strony/linku (dowód zgody); nieobsługiwany = język odbiorcy w bazie. */
  locale?: string | null;
  /** `all` = wszystkie kategorie naraz (tylko strona wypisania, po świadomym wyborze). */
  scope?: 'category' | 'all';
}

export async function applyUnsubscribe(
  token: unknown,
  options: UnsubscribeOptions = { source: 'unsubscribe_page' },
): Promise<UnsubscribeOutcome> {
  const secret = unsubscribeSecretFromEnv();
  if (!secret) return { status: 'unavailable' };
  const verified = verifyUnsubscribeToken(token, secret);
  if (!verified.ok) return { status: verified.reason === 'expired' ? 'expired' : 'invalid' };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 'unavailable' };
  }

  const locale = options.locale && isLocale(options.locale) ? options.locale : null;
  try {
    const { error } =
      options.scope === 'all'
        ? await createAdminClient().rpc('email_unsubscribe_all', {
            p_profile_id: verified.profileId,
            p_source: options.source,
            p_locale: locale,
          })
        : await createAdminClient().rpc('email_unsubscribe', {
            p_profile_id: verified.profileId,
            p_category: verified.category,
            p_source: options.source,
            p_locale: locale,
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
  return options.scope === 'all'
    ? { status: 'done', category: verified.category, scope: 'all' }
    : { status: 'done', category: verified.category };
}
