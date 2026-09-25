/**
 * Widoczność profilu kandydata dla firm (#494) — odczyt POD SESJĄ kandydata (własny wiersz
 * `candidate_profiles` pod RLS w `withPortalTransaction`; nigdy service-role).
 *
 * Egzekwowanie żyje w bazie (0029/0078/0100): profil, relacje profilu i dopasowania widzi
 * tylko zweryfikowana firma, gdy `is_searchable` i `profile_completed`, a kandydat jej nie
 * zablokował. Relacja z aplikacji/propozycji (`company_can_view_candidate`) zostaje po
 * wyłączeniu. Błąd odczytu = jawny `error` (bez udawania „ukryty"); technikalia do Sentry.
 *
 * Tryb demo (bez env): ukończony, ukryty profil (`demo: true`, Invariant #12).
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/sentry';

export interface ProfileVisibility {
  searchable: boolean;
  completed: boolean;
  /** Ostatnia realna zmiana (ISO); `null` = kandydat nigdy nie zmieniał ustawienia. */
  changedAt: string | null;
}

export type ProfileVisibilityLoad =
  | ({ status: 'ready'; demo: boolean } & ProfileVisibility)
  | { status: 'error' };

/**
 * Własny stan widoczności w podanej transakcji sesji — używa go też akcja zapisu, aby po RPC
 * odczytać stan z bazy w tej samej transakcji. Brak wiersza = profil jeszcze nie założony
 * (pierwszy krok onboardingu go tworzy) → ukryty, nieukończony.
 */
export async function readProfileVisibility(
  tx: TransactionQuery,
  profileId: string,
): Promise<ProfileVisibility> {
  const row = (await queryOne(tx, 'profile-visibility.own',
    `SELECT is_searchable, profile_completed, searchable_changed_at
       FROM public.candidate_profiles
      WHERE profile_id = $1`, [profileId])) ?? {};
  const changedAt = row['searchable_changed_at'];
  return {
    searchable: row['is_searchable'] === true,
    completed: row['profile_completed'] === true,
    changedAt: typeof changedAt === 'string' && changedAt.length > 0 ? changedAt : null,
  };
}

export async function loadProfileVisibility(): Promise<ProfileVisibilityLoad> {
  if (!isPortalDataConfigured()) {
    return { status: 'ready', demo: true, searchable: false, completed: true, changedAt: null };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };
    const visibility = await withPortalTransaction(me, (tx) => readProfileVisibility(tx, me.id));
    return { status: 'ready', demo: false, ...visibility };
  } catch (error) {
    captureError(error, { area: 'profile-visibility.load' });
    return { status: 'error' };
  }
}
