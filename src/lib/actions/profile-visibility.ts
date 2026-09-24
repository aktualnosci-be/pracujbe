'use server';

import { z } from 'zod/v3';

import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
import { loadProfileVisibility } from '@/lib/data/profile-visibility';

/**
 * Server Action widoczności profilu kandydata dla firm (#494).
 *
 * Zapis wyłącznie przez RPC `set_candidate_searchable` (SECURITY DEFINER, 0029/0100): konto
 * kandydata z sesji (właściciela nie przyjmujemy od klienta), `true` tylko dla ukończonego
 * profilu, `false` zawsze; znacznik czasu i historia zapisywane w bazie przy realnej zmianie.
 * Zwracany stan pochodzi z bazy (ponowny odczyt po zapisie), nie z wartości wysłanej przez
 * przeglądarkę. Błędy → kod użytkowy (Invariant #8).
 */

export type SetProfileVisibilityResult =
  | { ok: true; searchable: boolean; changedAt: string | null; demo?: boolean }
  | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  // 0110 (#492): profil bez ważnej deklaracji progu wieku nie staje się widoczny dla firm.
  if (m.includes('AGE_ATTESTATION_REQUIRED')) return 'AGE_ATTESTATION_REQUIRED';
  if (m.includes('VALIDATION_FAILED')) return 'ONBOARDING_INCOMPLETE';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('JWT')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

export async function setProfileVisibilityAction(searchable: unknown): Promise<SetProfileVisibilityResult> {
  const parsed = z.boolean().safeParse(searchable);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };

  if (!isSupabaseConfigured()) {
    return { ok: true, searchable: parsed.data, changedAt: new Date().toISOString(), demo: true };
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('set_candidate_searchable', { p_searchable: parsed.data });
    if (error) return { ok: false, error: mapPgError(error.message) };

    const confirmed = await loadProfileVisibility();
    if (confirmed.status === 'ready') {
      return { ok: true, searchable: confirmed.searchable, changedAt: confirmed.changedAt };
    }
    // Zapis przeszedł, odczyt nie: wartość zwrócona przez RPC jest stanem z bazy.
    return { ok: true, searchable: data === true, changedAt: null };
  } catch (error) {
    captureError(error, { area: 'profile-visibility.setAction' });
    return { ok: false, error: 'INTERNAL' };
  }
}
