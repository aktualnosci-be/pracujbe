/**
 * Widoczność profilu kandydata dla firm (#494) — odczyt POD SESJĄ kandydata (własny wiersz
 * `candidate_profiles` pod RLS; nigdy service-role).
 *
 * Egzekwowanie żyje w bazie (0029/0078/0100): profil, relacje profilu i dopasowania widzi
 * tylko zweryfikowana firma, gdy `is_searchable` i `profile_completed`, a kandydat jej nie
 * zablokował. Relacja z aplikacji/propozycji (`company_can_view_candidate`) zostaje po
 * wyłączeniu. Błąd odczytu = jawny `error` (bez udawania „ukryty"); technikalia do Sentry.
 *
 * Tryb demo (bez env): ukończony, ukryty profil (`demo: true`, Invariant #12).
 */

import { isSupabaseConfigured } from '@/lib/env';
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

export async function loadProfileVisibility(): Promise<ProfileVisibilityLoad> {
  if (!isSupabaseConfigured()) {
    return { status: 'ready', demo: true, searchable: false, completed: true, changedAt: null };
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'error' };

    const { data, error } = await supabase
      .from('candidate_profiles')
      .select('is_searchable, profile_completed, searchable_changed_at')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) throw error;
    // Brak wiersza = profil jeszcze nie założony (pierwszy krok onboardingu go tworzy).
    const row = (data ?? {}) as Record<string, unknown>;
    const changedAt = row['searchable_changed_at'];
    return {
      status: 'ready',
      demo: false,
      searchable: row['is_searchable'] === true,
      completed: row['profile_completed'] === true,
      changedAt: typeof changedAt === 'string' && changedAt.length > 0 ? changedAt : null,
    };
  } catch (error) {
    captureError(error, { area: 'profile-visibility.load' });
    return { status: 'error' };
  }
}
