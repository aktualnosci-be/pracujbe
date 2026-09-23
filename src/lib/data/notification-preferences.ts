/**
 * Warstwa danych preferencji powiadomień — Pracuj.be (Etap 6).
 *
 * Strategia spójna z pozostałymi loaderami panelu (`@/lib/data/candidate` itp.): przy
 * skonfigurowanym Supabase czytamy POD SESJĄ użytkownika (RLS `notification_preferences_select_own`,
 * NIGDY service-role). Gdy dla użytkownika nie ma jeszcze wiersza — zwracamy wartości DOMYŚLNE
 * (zgodne z DEFAULT-ami kolumn w migracji `0006_messaging.sql`), więc ekran ustawień pokazuje
 * poprawny stan startowy przed pierwszym zapisem. Bez env → te same wartości domyślne (build/UX
 * działa bez backendu).
 *
 * Klient Supabase importowany LENIWIE (moduł nie ciągnie `next/headers` do bundla trybu DEMO).
 * Błąd odczytu NIE jest zamieniany na wartości domyślne (#309): ekran dostałby fałszywy stan,
 * a zapis nadpisałby wcześniejsze opt-outy. Loader zwraca jawny wynik `ready | error`;
 * technikalia trafiają tylko do Sentry (Invariant #8).
 */

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/** Preferencje powiadomień zalogowanego użytkownika (kontrakt dla UI/akcji). */
export interface NotificationPreferences {
  emailApplications: boolean;
  emailOffers: boolean;
  emailMessages: boolean;
  emailJobMatches: boolean;
  emailMarketing: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
}

/**
 * Wartości domyślne — MUSZĄ odpowiadać DEFAULT-om kolumn w `notification_preferences`
 * (migracja `0006_messaging.sql`): e-maile transakcyjne włączone, marketing/push wyłączone,
 * powiadomienia in-app włączone.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailApplications: true,
  emailOffers: true,
  emailMessages: true,
  emailJobMatches: true,
  emailMarketing: false,
  pushEnabled: false,
  inAppEnabled: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Wynik odczytu: brak wiersza = wartości domyślne (`ready`), błąd ≠ wartości domyślne. */
export type NotificationPreferencesLoad =
  | { status: 'ready'; preferences: NotificationPreferences }
  | { status: 'error' };

/**
 * Odczyt preferencji powiadomień zalogowanego użytkownika. Brak wiersza / bez env → wartości
 * domyślne (`ready`). Brak sesji lub błąd zapytania → `error` (ekran blokuje zapis).
 */
export async function loadNotificationPreferences(): Promise<NotificationPreferencesLoad> {
  if (!isSupabaseConfigured()) {
    return { status: 'ready', preferences: DEFAULT_NOTIFICATION_PREFERENCES };
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'error' };

    const { data, error } = await supabase
      .from('notification_preferences')
      .select(
        'email_applications, email_offers, email_messages, email_job_matches, email_marketing, push_enabled, in_app_enabled',
      )
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: 'ready', preferences: DEFAULT_NOTIFICATION_PREFERENCES };

    const r = asRecord(data);
    const d = DEFAULT_NOTIFICATION_PREFERENCES;
    return {
      status: 'ready',
      preferences: {
        emailApplications: asBool(r['email_applications'], d.emailApplications),
        emailOffers: asBool(r['email_offers'], d.emailOffers),
        emailMessages: asBool(r['email_messages'], d.emailMessages),
        emailJobMatches: asBool(r['email_job_matches'], d.emailJobMatches),
        emailMarketing: asBool(r['email_marketing'], d.emailMarketing),
        pushEnabled: asBool(r['push_enabled'], d.pushEnabled),
        inAppEnabled: asBool(r['in_app_enabled'], d.inAppEnabled),
      },
    };
  } catch (error) {
    captureError(error, { area: 'notification-preferences.loadNotificationPreferences' });
    return { status: 'error' };
  }
}
