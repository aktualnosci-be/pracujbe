'use server';

import { agePolicyReasonError } from '@/lib/admin/age-policy';
import { isCandidateAgeBand } from '@/lib/age-policy/constants';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';

/**
 * Server Action panelu administratora — próg wieku konta kandydata (#492, `/admin/ustawienia`).
 *
 * `setCandidateMinAge` woła RPC `admin_set_candidate_min_age` (migracja 0126): tylko admin
 * (`is_admin()` w bazie), próg 16 albo 18, uzasadnienie ZAWSZE wymagane (≤ 1000 znaków, jak
 * `admin_set_company_status`), zapis audytu `age_policy.updated`. Podniesienie progu ukrywa od
 * razu profile kandydatów z niższą deklaracją wieku (RPC to robi samo) — RPC zwraca liczbę
 * ukrytych profili.
 *
 * Zapis pod SESJĄ admina (`withPortalTransaction`, `auth.uid()` = admin), bo RPC jest
 * `SECURITY DEFINER` i sam sprawdza `is_admin()` — service-role tu się nie nadaje (brak
 * tożsamości admina). Błędy bazy mapowane na stabilny `ErrorCode` (Invariant #8). Bez env →
 * tryb DEMO (`{ ok: true, demo: true }`).
 */

export type AgePolicyActionResult =
  | { ok: true; demo?: boolean; hiddenProfiles?: number }
  | { ok: false; error: ErrorCode; field?: 'reason'; reason?: 'required' | 'tooLong' };

function mapPgError(message: string): ErrorCode {
  if (message.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (
    message.includes('PERMISSION_DENIED') ||
    message.includes('UNAUTHENTICATED') ||
    message.includes('JWT') ||
    message.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

export async function setCandidateMinAge(
  minAge: number,
  confirmed: boolean,
  reason: string,
): Promise<AgePolicyActionResult> {
  if (!isCandidateAgeBand(minAge) || typeof confirmed !== 'boolean') {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  const reasonError = agePolicyReasonError(trimmedReason);
  if (reasonError) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: reasonError };
  }

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    let hidden: unknown;
    try {
      hidden = await withPortalTransaction(me, (tx) =>
        rpc(tx, 'admin_set_candidate_min_age', {
          p_min_age: minAge,
          p_confirmed: confirmed,
          p_reason: trimmedReason,
        }),
      );
    } catch (error) {
      if (isDatabaseError(error)) {
        const message = databaseErrorMessage(error);
        if (message.includes('VALIDATION_FAILED')) {
          return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'required' };
        }
        return { ok: false, error: mapPgError(message) };
      }
      throw error;
    }

    return { ok: true, hiddenProfiles: typeof hidden === 'number' ? hidden : 0 };
  } catch (error) {
    captureError(error, { area: 'admin.setCandidateMinAge' });
    return { ok: false, error: 'INTERNAL' };
  }
}
