'use server';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { execute, queryOne, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Server Actions panelu KANDYDATA — zapisywane pod sesją użytkownika (transakcja sesji
 * `withPortalTransaction`, RLS, nie service_role; #25).
 *
 *  - `toggleSavedJob`     — dodaje/usuwa ofertę z `saved_jobs` (unikat `candidate_id, job_id`).
 *  - `withdrawApplication`— wycofuje aplikację przez RPC `withdraw_application` (0025/0040:
 *    autoryzacja candidate_id = auth.uid(), idempotentne, historia z triggera).
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy baza nie jest skonfigurowana,
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

/**
 * Zapisuje/usuwa ofertę z listy zapisanych kandydata. Zwraca stan `saved` po zapisie.
 *
 * Z `desired` akcja ustawia stan docelowy i jest idempotentna: ponowienie tego samego żądania
 * (zgubiona odpowiedź, druga karta, podwójne kliknięcie) daje ten sam wynik zamiast go odwracać.
 * Równoległy insert tej samej pary kończy się naruszeniem unikatu `(candidate_id, job_id)`,
 * które oznacza, że oferta jest już zapisana. Bez `desired` — dotychczasowy toggle.
 */
export async function toggleSavedJob(
  jobId: string,
  desired?: boolean,
): Promise<ToggleSavedResult> {
  if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  if (desired !== undefined && typeof desired !== 'boolean') {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  // Tryb demo — brak zapisu; klient trzyma optymistyczny stan przycisku.
  if (!isPortalDataConfigured()) return { ok: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    return await withPortalTransaction(me, async (tx): Promise<ToggleSavedResult> => {
      let target = desired;
      if (target === undefined) {
        // Stan bieżący (RLS: kandydat czyta wyłącznie własne saved_jobs).
        const existing = await queryOne(tx, 'candidate.saved-job-state',
          'SELECT id FROM public.saved_jobs WHERE candidate_id = $1 AND job_id = $2', [me.id, jobId]);
        target = !existing;
      }

      if (!target) {
        // DELETE brakującego wiersza nie jest błędem — ponowienie daje ten sam stan.
        await execute(tx, 'candidate.saved-job-delete',
          'DELETE FROM public.saved_jobs WHERE candidate_id = $1 AND job_id = $2', [me.id, jobId]);
        return { ok: true, saved: false };
      }

      // Istniejący wiersz (także równoległy insert tej samej pary) = oferta już zapisana:
      // unikat `(candidate_id, job_id)` + ON CONFLICT DO NOTHING zamiast błędu 23505.
      await execute(tx, 'candidate.saved-job-insert',
        `INSERT INTO public.saved_jobs (candidate_id, job_id) VALUES ($1, $2)
         ON CONFLICT (candidate_id, job_id) DO NOTHING`, [me.id, jobId]);
      return { ok: true, saved: true };
    });
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'candidate.toggleSavedJob' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Wycofuje aplikację kandydata (status → 'withdrawn'). */
export async function withdrawApplication(applicationId: string): Promise<WithdrawResult> {
  if (typeof applicationId !== 'string' || !UUID_RE.test(applicationId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isPortalDataConfigured()) return { ok: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    // Bezpośredni DML na `applications` jest odebrany klientowi (0025, granica zaufania) —
    // wycofanie idzie przez SECURITY DEFINER RPC (autoryzacja auth.uid()=candidate_id,
    // idempotentne, historia z triggera). Zwraca finalny status.
    await withPortalTransaction(me, (tx) => rpc(tx, 'withdraw_application', { p_application_id: applicationId }));
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'candidate.withdrawApplication' });
    return { ok: false, error: 'INTERNAL' };
  }
}
