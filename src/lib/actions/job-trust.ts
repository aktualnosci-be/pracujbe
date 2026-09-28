'use server';

import { revalidatePath } from 'next/cache';

import { agencyNumberError, AGENCY_CHECK_NOTE_MAX } from '@/lib/job-trust/agency';
import {
  isJobContentReviewDecision,
  jobContentReviewReasonError,
  type JobContentReviewDecision,
} from '@/lib/job-trust/review';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, rpc, type RpcArgs } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { checkRateLimit } from '@/lib/rate-limit';
import { revalidatePublicJobPaths } from '@/lib/jobs/public-cache';

/**
 * Server Actions zaufania ofert (0910):
 *   - `decideJobContentReview` — decyzja admina o treści oferty z sygnałem (reguły/AI) przez
 *     RPC `admin_decide_job_content_review` (tylko oczekujące, bieżąca treść, odrzucenie
 *     z uzasadnieniem, audyt, powiadomienie zgłaszającego). Akceptacja nie publikuje.
 *   - `recordAgencyCheck` — wynik ręcznego sprawdzenia numeru uznania agencji (admin, CAS po
 *     numerze, `admin_record_agency_check`).
 *   - `updateCompanyAgency` — deklaracja firmy „agencja pracy tymczasowej” + numer uznania
 *     (owner/admin firmy, `set_company_agency`; zmiana zeruje sprawdzenie admina).
 *
 * Zapis pod SESJĄ użytkownika (RPC SECURITY DEFINER sprawdzają rolę na `auth.uid()`).
 * Błędy bazy → stabilny `ErrorCode` (Invariant #8). Bez env → tryb DEMO bez zapisu.
 */

export type TrustActionResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode; field?: 'reason' | 'number' | 'note'; reason?: 'required' | 'tooLong' };

export type CompanyAgencyResult =
  | { ok: true; demo?: boolean; outcome: 'saved' | 'unchanged' }
  | { ok: false; error: ErrorCode; field?: 'number'; reason?: 'required' | 'tooLong' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('STALE_STATE')) return 'STALE_STATE';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('row-level security')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

type RpcCall =
  | { status: 'ok'; data: unknown }
  | { status: 'unauthenticated' }
  | { status: 'db_error'; message: string };

async function callRpc(fn: string, args: RpcArgs): Promise<RpcCall> {
  const me = await getPortalIdentity();
  if (!me) return { status: 'unauthenticated' };
  try {
    const data = await withPortalTransaction(me, (tx) => rpc(tx, fn, args));
    return { status: 'ok', data };
  } catch (error) {
    if (isDatabaseError(error)) return { status: 'db_error', message: databaseErrorMessage(error) };
    throw error;
  }
}

export async function decideJobContentReview(
  reviewId: string,
  decision: JobContentReviewDecision,
  reason: string,
): Promise<TrustActionResult> {
  if (!isJobContentReviewDecision(decision)) return { ok: false, error: 'VALIDATION_FAILED' };
  const text = typeof reason === 'string' ? reason : '';
  const reasonError = jobContentReviewReasonError(decision, text);
  if (reasonError) return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: reasonError };
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (typeof reviewId !== 'string' || !UUID_RE.test(reviewId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const trimmed = text.trim();
    const call = await callRpc('admin_decide_job_content_review', {
      p_review_id: reviewId,
      p_decision: decision,
      p_reason: trimmed.length > 0 ? trimmed : null,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') {
      if (call.message.includes('REASON_REQUIRED')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'required' };
      }
      if (call.message.includes('REASON_TOO_LONG')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'tooLong' };
      }
      return { ok: false, error: mapPgError(call.message) };
    }
    revalidatePath('/[locale]/admin/tresc-ofert', 'page');
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'job-trust.decideJobContentReview' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function recordAgencyCheck(
  companyId: string,
  result: 'confirmed' | 'not_confirmed',
  expectedNumber: string,
  note: string,
): Promise<TrustActionResult> {
  if (result !== 'confirmed' && result !== 'not_confirmed') return { ok: false, error: 'VALIDATION_FAILED' };
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > AGENCY_CHECK_NOTE_MAX) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'note', reason: 'tooLong' };
  }
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId) || typeof expectedNumber !== 'string') {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  try {
    const call = await callRpc('admin_record_agency_check', {
      p_company_id: companyId,
      p_result: result,
      p_expected_number: expectedNumber,
      p_note: text.length > 0 ? text : null,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') return { ok: false, error: mapPgError(call.message) };
    revalidatePath('/[locale]/admin/firmy/[id]', 'page');
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'job-trust.recordAgencyCheck' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/**
 * Deklaracja agencji pracy tymczasowej (owner/admin firmy). `companyId` z formularza
 * wyrenderowanego dla tej firmy (jak linki firmy) — członkostwo sprawdzane jawnie.
 */
export async function updateCompanyAgency(
  companyId: string,
  isAgency: boolean,
  recognitionNumber: string,
): Promise<CompanyAgencyResult> {
  const agency = isAgency === true;
  const number = agency && typeof recognitionNumber === 'string' ? recognitionNumber.trim() : '';
  if (agency) {
    const numberError = agencyNumberError(number);
    if (numberError) return { ok: false, error: 'VALIDATION_FAILED', field: 'number', reason: numberError };
  }
  if (!isPortalDataConfigured()) return { ok: true, demo: true, outcome: 'unchanged' };
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) return { ok: false, error: 'NOT_FOUND' };
  if (!(await checkRateLimit('company-update', { max: 60, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    type Outcome = { error: ErrorCode } | { error: null; result: unknown };
    const outcome = await withPortalTransaction(me, async (tx): Promise<Outcome> => {
      const membership = await queryOne<Record<string, unknown>>(tx, 'job-trust.agency-membership',
        `SELECT m.role FROM public.company_members m
          WHERE m.profile_id = $1 AND m.company_id = $2 AND m.is_active = true LIMIT 1`,
        [me.id, companyId]);
      if (!membership) return { error: 'NOT_FOUND' };
      if (membership['role'] !== 'owner' && membership['role'] !== 'admin') return { error: 'PERMISSION_DENIED' };
      const result = await rpc(tx, 'set_company_agency', {
        p_company_id: companyId,
        p_is_agency: agency,
        p_recognition_number: agency ? number : null,
      });
      return { error: null, result };
    });
    if (outcome.error !== null) return { ok: false, error: outcome.error };
    const result = outcome.result === 'saved' ? 'saved' : 'unchanged';
    revalidatePath('/employer', 'layout');
    // Etykieta „agencja” na kartach i szczególe ofert firmy (ISR).
    if (result === 'saved') revalidatePublicJobPaths();
    return { ok: true, outcome: result };
  } catch (e) {
    if (isDatabaseError(e)) return { ok: false, error: mapPgError(databaseErrorMessage(e)) };
    captureError(e, { area: 'job-trust.updateCompanyAgency' });
    return { ok: false, error: 'INTERNAL' };
  }
}
