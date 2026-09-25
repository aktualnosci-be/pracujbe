/**
 * Warstwa danych preferencji powiadomień — Pracuj.be (Etap 6).
 *
 * Strategia spójna z pozostałymi loaderami panelu (`@/lib/data/candidate` itp.): przy
 * skonfigurowanym backendzie (`isPortalDataConfigured()`) czytamy POD SESJĄ użytkownika
 * (`withPortalTransaction`, RLS `notification_preferences_select_own`, NIGDY service-role). Gdy dla użytkownika nie ma jeszcze wiersza — zwracamy wartości DOMYŚLNE
 * (zgodne z DEFAULT-ami kolumn w migracji `0006_messaging.sql`), więc ekran ustawień pokazuje
 * poprawny stan startowy przed pierwszym zapisem. Bez env → te same wartości domyślne (build/UX
 * działa bez backendu).
 *
 * Błąd odczytu NIE jest zamieniany na wartości domyślne (#309): ekran dostałby fałszywy stan,
 * a zapis nadpisałby wcześniejsze opt-outy. Loader zwraca jawny wynik `ready | error`;
 * technikalia trafiają tylko do kanału błędów (Invariant #8).
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

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
  if (!isPortalDataConfigured()) {
    return { status: 'ready', preferences: DEFAULT_NOTIFICATION_PREFERENCES };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };

    // Filtr po własnym profilu + RLS (tylko własny wiersz) — dwie niezależne granice.
    const data = await withPortalTransaction(me, (tx) =>
      queryOne(
        tx,
        'notification-preferences.own',
        `SELECT email_applications, email_offers, email_messages, email_job_matches,
                email_marketing, push_enabled, in_app_enabled
           FROM public.notification_preferences
          WHERE profile_id = $1`,
        [me.id],
      ),
    );
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
