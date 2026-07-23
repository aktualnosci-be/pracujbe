'use server';

import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';

/**
 * Server Action preferencji powiadomień — zapis POD SESJĄ użytkownika (RLS, nie service-role).
 *
 * `updateNotificationPreferences` waliduje wejście schematem Zod (bool per pole) i robi UPSERT
 * do `notification_preferences` po unikalnym `profile_id = auth.uid()`. RLS
 * (`notification_preferences_insert_own` / `_update_own`) gwarantuje, że użytkownik zapisuje
 * wyłącznie własny wiersz.
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy Supabase nie jest skonfigurowane,
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
    m.includes('JWT') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/**
 * Zapisuje (UPSERT) preferencje powiadomień zalogowanego użytkownika.
 *
 * @param input surowe dane (walidowane `preferencesSchema` — 7 pól bool)
 */
export async function updateNotificationPreferences(
  input: unknown,
): Promise<UpdateNotificationPreferencesResult> {
  // 1) Walidacja (bool per pole) — bez zaufania do klienta.
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const prefs = parsed.data;

  // 2) Tryb demo (brak env) — nie zapisujemy, ale przepływ działa.
  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    // 3) Autoryzacja — potrzebny zalogowany użytkownik.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    // 4) UPSERT po unikalnym profile_id (RLS: właściciel insert/update własnego wiersza).
    const { error } = await supabase.from('notification_preferences').upsert(
      {
        profile_id: user.id,
        email_applications: prefs.emailApplications,
        email_offers: prefs.emailOffers,
        email_messages: prefs.emailMessages,
        email_job_matches: prefs.emailJobMatches,
        email_marketing: prefs.emailMarketing,
        push_enabled: prefs.pushEnabled,
        in_app_enabled: prefs.inAppEnabled,
      },
      { onConflict: 'profile_id' },
    );
    if (error) return { ok: false, error: mapPgError(error.message) };
    return { ok: true };
  } catch {
    // Nieoczekiwany błąd — bez technikaliów dla użytkownika (Invariant #8).
    return { ok: false, error: 'INTERNAL' };
  }
}
