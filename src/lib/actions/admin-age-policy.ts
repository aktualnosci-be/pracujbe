'use server';

import { agePolicyReasonError } from '@/lib/admin/age-policy';
import { isCandidateAgeBand } from '@/lib/age-policy/constants';
import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import {
  getPortalIdentity,
  isPortalDataConfigured,
  withPortalTransaction,
} from '@/lib/db/portal';
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
 * Kontrola wersji (CAS, #1102): formularz przekazuje `expectedUpdatedAt` — znacznik zmiany progu,
 * który administrator widział (`age_policy.updated_at` jako tekst, `null` = brak wiersza). RPC
 * (migracja 0946) porównuje go z bieżącym po `FOR UPDATE` w tej samej transakcji co zapis —
 * zmiana innego administratora albo zatwierdzenie właściciela w międzyczasie → `STALE_STATE`
 * zamiast cichego nadpisania.
 *
 * Status „zatwierdzone przez właściciela” nie pochodzi z formularza (#639): każda zmiana
 * administratora zapisuje wartość roboczą; zatwierdza wyłącznie właściciel drogą operatorską
 * (`owner_confirm_candidate_min_age`, service_role — `scripts/db/confirm-age-policy.mjs`).
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
  if (message.includes('STALE_STATE')) return 'STALE_STATE';
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

/** Znacznik wersji = tekst daty Postgresa (`updated_at::text`); inny kształt nie trafia do bazy. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

function isTimestamp(value: string): boolean {
  return TIMESTAMP_RE.test(value);
}

export async function setCandidateMinAge(
  minAge: number,
  reason: string,
  expectedUpdatedAt: string | null,
): Promise<AgePolicyActionResult> {
  if (
    !isCandidateAgeBand(minAge) ||
    (expectedUpdatedAt !== null && (typeof expectedUpdatedAt !== 'string' || !isTimestamp(expectedUpdatedAt)))
  ) {
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
          p_reason: trimmedReason,
          p_expected_updated_at: expectedUpdatedAt,
        }),
      );
    } catch (error) {
      if (isDatabaseError(error)) {
        const message = databaseErrorMessage(error);
        if (message.includes('STALE_STATE')) return { ok: false, error: 'STALE_STATE' };
        if (message.includes('VALIDATION_FAILED')) {
          return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'required' };
        }
        return { ok: false, error: reportUnmappedDbError(error, 'admin.setCandidateMinAge', mapPgError(message)) };
      }
      throw error;
    }

    return { ok: true, hiddenProfiles: typeof hidden === 'number' ? hidden : 0 };
  } catch (error) {
    captureError(error, { area: 'admin.setCandidateMinAge' });
    return { ok: false, error: 'INTERNAL' };
  }
}
