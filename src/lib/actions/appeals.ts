'use server';

import {
  appealDecisionError,
  appealFieldFromDbMessage,
  appealGroundsError,
  appealNeedsRestriction,
  isAppealRole,
  type AppealDecisionField,
  type AppealDecisionInput,
} from '@/lib/admin/appeals';
import type { ModerationFieldError } from '@/lib/admin/moderation';
import { FIXTURE_DISMISSED_CASE_NUMBER, isReportFixtureMode } from '@/lib/content-reports/case';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { reportCaseLookupSchema } from '@/lib/validation/content-report';

/**
 * Odwołania od decyzji moderacyjnych (DSA, #43) — cienka warstwa nad RPC z migracji 0104.
 *
 *   - `submitModerationAppeal` — autor treści (owner/admin firmy) pod SESJĄ: RPC sam sprawdza
 *     członkostwo, termin od poinformowania i to, że od decyzji przysługuje odwołanie.
 *   - `submitReportAppeal` — zgłaszający, numer sprawy + kod dostępu (jak sprawdzenie sprawy).
 *     RPC ma EXECUTE tylko dla service_role — inaczej PostgREST pozwalałby ominąć limiter.
 *   - `decideAppeal` — rozpatrzenie przez administratora (inny niż autor decyzji, gdy to
 *     możliwe); skutek, historia, audyt i powiadomienia w jednej transakcji w bazie.
 *
 * Klucz idempotencji przychodzi z przeglądarki (jeden na otwarty formularz): ponowienie po
 * zerwanym połączeniu zwraca to samo odwołanie. Błędy Postgresa → stabilny `ErrorCode`.
 */

export type AppealActionResult =
  | { ok: true; reference: string; created: boolean; demo?: boolean }
  | { ok: false; error: ErrorCode; field?: 'grounds'; fieldError?: ModerationFieldError };

export type AppealDecisionResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode; field?: AppealDecisionField; fieldError?: ModerationFieldError };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kod z serwera fixture E2E (bez bazy) — nigdy w buildzie produkcyjnym. */
const FIXTURE_APPEAL_REFERENCE = 'APL-0000-0000-0E2E';

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('APPEAL_EXISTS')) return 'APPEAL_EXISTS';
  if (m.includes('APPEAL_WINDOW_CLOSED')) return 'APPEAL_WINDOW_CLOSED';
  if (m.includes('REVIEWER_CONFLICT')) return 'REVIEWER_CONFLICT';
  if (m.includes('STALE_STATE')) return 'STALE_STATE';
  if (m.includes('INVALID_TRANSITION')) return 'INVALID_TRANSITION';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
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

function firstRow(data: unknown): { reference: string; created: boolean } | null {
  const row = (Array.isArray(data) ? data[0] : data) as { reference?: unknown; created?: unknown } | null;
  if (!row || typeof row.reference !== 'string') return null;
  return { reference: row.reference, created: row.created === true };
}

function groundsFailure(message: string): AppealActionResult | null {
  const field = appealFieldFromDbMessage(message);
  return field && field.field === 'grounds'
    ? { ok: false, error: 'VALIDATION_FAILED', field: 'grounds', fieldError: field.error }
    : null;
}

/** Odwołanie autora treści od ograniczenia (panel firmy). */
export async function submitModerationAppeal(
  decisionId: string,
  grounds: string,
  idempotencyKey: string,
): Promise<AppealActionResult> {
  const groundsError = appealGroundsError(grounds);
  if (groundsError) return { ok: false, error: 'VALIDATION_FAILED', field: 'grounds', fieldError: groundsError };
  if (typeof idempotencyKey !== 'string' || !UUID_RE.test(idempotencyKey)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  if (!isSupabaseConfigured()) {
    return { ok: true, reference: FIXTURE_APPEAL_REFERENCE, created: true, demo: true };
  }
  if (typeof decisionId !== 'string' || !UUID_RE.test(decisionId)) return { ok: false, error: 'NOT_FOUND' };
  if (!(await checkRateLimit('moderation-appeal', { max: 10, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { data, error } = await supabase.rpc('submit_moderation_appeal', {
      p_decision_id: decisionId,
      p_idempotency_key: idempotencyKey,
      p_grounds: grounds.trim(),
    });
    if (error) {
      const message = error.message ?? '';
      const field = groundsFailure(message);
      if (field) return field;
      const code = mapPgError(message);
      if (code === 'INTERNAL') captureError(error, { area: 'appeals.submitModeration' });
      return { ok: false, error: code };
    }
    const row = firstRow(data);
    if (!row) {
      captureError(new Error('submit_moderation_appeal: pusta odpowiedź'), { area: 'appeals.submitModeration' });
      return { ok: false, error: 'INTERNAL' };
    }
    return { ok: true, ...row };
  } catch (error) {
    captureError(error, { area: 'appeals.submitModeration' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export interface ReportAppealInput {
  caseNumber: string;
  accessCode: string;
  grounds: string;
  idempotencyKey: string;
}

/** Odwołanie zgłaszającego od decyzji o braku działań (strona sprawy). */
export async function submitReportAppeal(input: ReportAppealInput): Promise<AppealActionResult> {
  if (!(await checkRateLimit('report-appeal', { max: 10, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const lookup = reportCaseLookupSchema.safeParse({
    caseNumber: input?.caseNumber ?? '',
    accessCode: input?.accessCode ?? '',
  });
  if (!lookup.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const groundsError = appealGroundsError(input.grounds);
  if (groundsError) return { ok: false, error: 'VALIDATION_FAILED', field: 'grounds', fieldError: groundsError };
  if (typeof input.idempotencyKey !== 'string' || !UUID_RE.test(input.idempotencyKey)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isSupabaseConfigured()) {
    if (isReportFixtureMode()) {
      return lookup.data.caseNumber === FIXTURE_DISMISSED_CASE_NUMBER
        ? { ok: true, reference: FIXTURE_APPEAL_REFERENCE, created: true }
        : { ok: false, error: 'NOT_FOUND' };
    }
    return { ok: false, error: 'DEMO_UNAVAILABLE' };
  }

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('submit_report_appeal', {
      p_case_number: lookup.data.caseNumber,
      p_access_code: lookup.data.accessCode,
      p_idempotency_key: input.idempotencyKey,
      p_grounds: input.grounds.trim(),
    });
    if (error) {
      const message = error.message ?? '';
      const field = groundsFailure(message);
      if (field) return field;
      const code = mapPgError(message);
      if (code === 'INTERNAL') captureError(error, { area: 'appeals.submitReport' });
      return { ok: false, error: code };
    }
    const row = firstRow(data);
    if (!row) {
      captureError(new Error('submit_report_appeal: pusta odpowiedź'), { area: 'appeals.submitReport' });
      return { ok: false, error: 'INTERNAL' };
    }
    return { ok: true, ...row };
  } catch (error) {
    captureError(error, { area: 'appeals.submitReport' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/**
 * Rozpatrzenie odwołania (tylko admin — egzekwuje RPC). `expectedStatus` = status widziany
 * przez admina (CAS → `STALE_STATE`). `role`/`targetType` wyznaczają wymagane pola.
 */
export async function decideAppeal(
  appealId: string,
  expectedStatus: string,
  role: string,
  targetType: string,
  input: AppealDecisionInput,
): Promise<AppealDecisionResult> {
  if (typeof appealId !== 'string' || expectedStatus !== 'pending' || !isAppealRole(role)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const invalid = appealDecisionError(input, role, targetType);
  if (invalid) return { ok: false, error: 'VALIDATION_FAILED', field: invalid.field, fieldError: invalid.error };
  const restricts = appealNeedsRestriction(role, input.outcome);

  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (!UUID_RE.test(appealId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_decide_appeal', {
      p_appeal_id: appealId,
      p_expected_status: expectedStatus,
      p_outcome: input.outcome,
      p_reasoning: input.reasoning.trim(),
      p_new_decision: restricts ? (input.decision ?? null) : null,
      p_ground_type: restricts ? (input.groundType ?? null) : null,
      p_ground_reference: restricts ? (input.groundReference ?? '').trim() : null,
    });
    if (error) {
      const message = error.message ?? '';
      const field = message.includes('VALIDATION_FAILED') ? appealFieldFromDbMessage(message) : null;
      if (field && field.field !== 'grounds') {
        return { ok: false, error: 'VALIDATION_FAILED', field: field.field, fieldError: field.error };
      }
      const code = mapPgError(message);
      if (code === 'INTERNAL') captureError(error, { area: 'appeals.decide' });
      return { ok: false, error: code };
    }
    return { ok: true };
  } catch (error) {
    captureError(error, { area: 'appeals.decide' });
    return { ok: false, error: 'INTERNAL' };
  }
}
