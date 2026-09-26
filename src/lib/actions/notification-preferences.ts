'use server';

import { z } from 'zod/v3';

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { jsonArg, rpc } from '@/lib/db/sql';
import { routing } from '@/i18n/routing';
import { emailConsentWordingVersion } from '@/lib/email/consent-wording';
import type { ErrorCode } from '@/lib/errors';
import type { NotificationPreferencesRole } from '@/lib/settings/email-preference-fields';

/**
 * Server Action preferencji powiadomień — zapis POD SESJĄ użytkownika (nie service-role).
 *
 * `updateNotificationPreferences` waliduje wejście schematem Zod (bool per pole, język strony)
 * i woła RPC `set_notification_preferences` (0101), które zapisuje własny wiersz (`auth.uid()`)
 * i dowód każdej zmiany zgody e-mail: źródło `settings`, język strony i wersję pokazanej treści
 * (`emailConsentWordingVersion`, #45). Rola użyta do wyliczenia tej wersji pochodzi WYŁĄCZNIE
 * z `getPortalIdentity()` (rola profilu z sesji) — formularz nie przekazuje roli jako
 * zaufanego wejścia, bo klient mógłby podpisać dowód treścią przeznaczoną dla innej roli (#605).
 *
 * #25: RPC w transakcji sesji (`withPortalTransaction`, rola authenticated + `app.current_uid`).
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy backend nie jest skonfigurowany,
 * walidujemy dane, ale NIE zapisujemy — zwracamy `{ ok: true, demo: true }`. Błędy mapujemy na
 * kod użytkowy (Invariant #8, bez technikaliów).
 */

const preferencesSchema = z.object({
  emailApplications: z.boolean(),
  emailOffers: z.boolean(),
  emailMessages: z.boolean(),
  emailJobMatches: z.boolean(),
  emailMarketing: z.boolean(),
  pushEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  locale: z.enum(routing.locales),
});

export type UpdateNotificationPreferencesResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/**
 * Zapisuje (UPSERT) preferencje powiadomień zalogowanego użytkownika.
 *
 * @param input surowe dane (walidowane `preferencesSchema` — 7 pól bool + język strony)
 */
export async function updateNotificationPreferences(
  input: unknown,
): Promise<UpdateNotificationPreferencesResult> {
  // 1) Walidacja (bool per pole) — bez zaufania do klienta.
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const prefs = parsed.data;

  // 2) Tryb demo (brak env) — nie zapisujemy, ale przepływ działa.
  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    // 3) Autoryzacja — potrzebny zalogowany użytkownik (tożsamość z sesji serwera).
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    // Rola dla dowodu zgody (#605): WYŁĄCZNIE z profilu sesji, nigdy z formularza klienta.
    // Ten ekran ustawień istnieje tylko dla kandydata i pracodawcy — admin go nie ma.
    const role: NotificationPreferencesRole | null =
      me.role === 'candidate' || me.role === 'employer' ? me.role : null;
    if (!role) return { ok: false, error: 'PERMISSION_DENIED' };

    // 4) RPC: upsert własnego wiersza + dowód zmiany zgody (0101).
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'set_notification_preferences', {
        p_prefs: jsonArg({
          email_applications: prefs.emailApplications,
          email_offers: prefs.emailOffers,
          email_messages: prefs.emailMessages,
          email_job_matches: prefs.emailJobMatches,
          email_marketing: prefs.emailMarketing,
          push_enabled: prefs.pushEnabled,
          in_app_enabled: prefs.inAppEnabled,
        }),
        p_locale: prefs.locale,
        p_wording_version: emailConsentWordingVersion(prefs.locale, role),
      }),
    );
    return { ok: true };
  } catch (error) {
    // Błąd bazy → kod użytkowy; nieoczekiwany błąd — bez technikaliów (Invariant #8).
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    return { ok: false, error: 'INTERNAL' };
  }
}
