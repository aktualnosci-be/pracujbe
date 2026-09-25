'use server';

import { z } from 'zod/v3';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { attempt, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { readProfileVisibility } from '@/lib/data/profile-visibility';

/**
 * Server Action widoczności profilu kandydata dla firm (#494).
 *
 * Zapis wyłącznie przez RPC `set_candidate_searchable` (SECURITY DEFINER, 0029/0100): konto
 * kandydata z sesji (właściciela nie przyjmujemy od klienta), `true` tylko dla ukończonego
 * profilu, `false` zawsze; znacznik czasu i historia zapisywane w bazie przy realnej zmianie.
 * Zwracany stan pochodzi z bazy (ponowny odczyt po zapisie w tej samej transakcji sesji),
 * nie z wartości wysłanej przez przeglądarkę. Błędy → kod użytkowy (Invariant #8).
 */

export type SetProfileVisibilityResult =
  | { ok: true; searchable: boolean; changedAt: string | null; demo?: boolean }
  | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  // 0126 (#492): profil bez ważnej deklaracji progu wieku nie staje się widoczny dla firm.
  if (m.includes('AGE_ATTESTATION_REQUIRED')) return 'AGE_ATTESTATION_REQUIRED';
  // 0126 (#576): konto 16–17 — widoczność profilu dla firm tylko dla pełnoletnich.
  if (m.includes('AGE_ADULT_REQUIRED')) return 'AGE_ADULT_REQUIRED';
  if (m.includes('VALIDATION_FAILED')) return 'ONBOARDING_INCOMPLETE';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('JWT')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

export async function setProfileVisibilityAction(searchable: unknown): Promise<SetProfileVisibilityResult> {
  const parsed = z.boolean().safeParse(searchable);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };

  if (!isPortalDataConfigured()) {
    return { ok: true, searchable: parsed.data, changedAt: new Date().toISOString(), demo: true };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    return await withPortalTransaction(me, async (tx): Promise<SetProfileVisibilityResult> => {
      const data = await rpc(tx, 'set_candidate_searchable', { p_searchable: parsed.data });
      // Odczyt w SAVEPOINT: jego awaria nie cofa zapisu.
      const confirmed = await attempt(tx, () => readProfileVisibility(tx, me.id));
      if (confirmed.ok) {
        return { ok: true, searchable: confirmed.value.searchable, changedAt: confirmed.value.changedAt };
      }
      captureError(confirmed.error, { area: 'profile-visibility.setAction.read' });
      // Zapis przeszedł, odczyt nie: wartość zwrócona przez RPC jest stanem z bazy.
      return { ok: true, searchable: data === true, changedAt: null };
    });
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'profile-visibility.setAction' });
    return { ok: false, error: 'INTERNAL' };
  }
}
