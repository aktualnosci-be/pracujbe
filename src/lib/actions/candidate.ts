'use server';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';

/**
 * Server Actions panelu KANDYDATA — zapisywane pod sesją użytkownika (RLS, nie service-role).
 *
 *  - `toggleSavedJob`     — dodaje/usuwa ofertę z `saved_jobs` (unikat `candidate_id, job_id`).
 *  - `withdrawApplication`— wycofuje aplikację (`status = 'withdrawn'`). RLS `applications_update`
 *    (candidate_id = auth.uid()) + trigger `enforce_application_integrity` dopuszczają dla właściciela
 *    wyłącznie przejście do 'withdrawn' — reszta pól pozostaje niezmienna.
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy Supabase nie jest skonfigurowane,
 * nie zapisujemy — zwracamy `{ ok: true }` (dla toggla echo optymistycznego stanu robi klient).
 * Błędy mapujemy na kod użytkowy — bez technikaliów (Invariant #8).
 */

export type ToggleSavedResult = { ok: true; saved?: boolean } | { ok: false; error: ErrorCode };
export type WithdrawResult = { ok: true } | { ok: false; error: ErrorCode };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
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

/** Zapisuje/usuwa ofertę z listy zapisanych kandydata (toggle). Zwraca nowy stan `saved`. */
export async function toggleSavedJob(jobId: string): Promise<ToggleSavedResult> {
  if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  // Tryb demo — brak zapisu; klient trzyma optymistyczny stan przycisku.
  if (!isSupabaseConfigured()) return { ok: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    // Stan bieżący (RLS: kandydat czyta wyłącznie własne saved_jobs).
    const { data: existing, error: selError } = await supabase
      .from('saved_jobs')
      .select('id')
      .eq('candidate_id', user.id)
      .eq('job_id', jobId)
      .maybeSingle();
    if (selError) return { ok: false, error: mapPgError(selError.message) };

    if (existing) {
      const { error: delError } = await supabase
        .from('saved_jobs')
        .delete()
        .eq('candidate_id', user.id)
        .eq('job_id', jobId);
      if (delError) return { ok: false, error: mapPgError(delError.message) };
      return { ok: true, saved: false };
    }

    const { error: insError } = await supabase
      .from('saved_jobs')
      .insert({ candidate_id: user.id, job_id: jobId });
    if (insError) return { ok: false, error: mapPgError(insError.message) };
    return { ok: true, saved: true };
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Wycofuje aplikację kandydata (status → 'withdrawn'). */
export async function withdrawApplication(applicationId: string): Promise<WithdrawResult> {
  if (typeof applicationId !== 'string' || !UUID_RE.test(applicationId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isSupabaseConfigured()) return { ok: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    // RLS + trigger zapewniają, że kandydat może zmienić TYLKO własną aplikację i TYLKO na 'withdrawn'.
    const { error } = await supabase
      .from('applications')
      .update({ status: 'withdrawn' })
      .eq('id', applicationId)
      .eq('candidate_id', user.id);
    if (error) return { ok: false, error: mapPgError(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }
}
