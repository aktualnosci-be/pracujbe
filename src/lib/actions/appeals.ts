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
import {
  FIXTURE_DISMISSED_CASE_NUMBER,
  FIXTURE_RESTORED_CASE_NUMBER,
  isReportFixtureMode,
} from '@/lib/content-reports/case';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import {
  getPortalIdentity,
  isPortalDataConfigured,
  isServiceDatabaseConfigured,
  withPortalTransaction,
  withServiceRole,
} from '@/lib/db/portal';
import { rpc, rpcRows } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { reportCaseLookupSchema } from '@/lib/validation/content-report';

/**
 * Odwołania od decyzji moderacyjnych (DSA, #43) — cienka warstwa nad RPC z migracji 0104.
 *
 *   - `submitModerationAppeal` — autor treści (owner/admin firmy) pod SESJĄ: RPC sam sprawdza
 *     członkostwo, termin od poinformowania i to, że od decyzji przysługuje odwołanie.
 *   - `submitReportAppeal` — zgłaszający, numer sprawy + kod dostępu (jak sprawdzenie sprawy):
 *     od braku działań (`submit_report_appeal`) albo od cofnięcia ograniczenia
 *     (`target: 'restoration'` → `submit_report_restoration_appeal`, 0108). Oba RPC mają
 *     EXECUTE tylko dla service_role — inaczej bezpośrednie wywołanie omijałoby limiter.
 *   - `decideAppeal` — rozpatrzenie przez administratora (inny niż autor decyzji, gdy to
 *     możliwe); skutek, historia, audyt i powiadomienia w jednej transakcji w bazie.
 *
 * Klucz idempotencji przychodzi z przeglądarki (jeden na otwarty formularz): ponowienie po
 * zerwanym połączeniu zwraca to samo odwołanie. Błędy Postgresa → stabilny `ErrorCode`.
 *
 * #25: RPC autora i admina idą pod sesją (`getPortalIdentity()` + `withPortalTransaction`,
 * rola `authenticated`, `auth.uid()` = użytkownik — RPC są SECURITY DEFINER i sprawdzają
 * członkostwo/`is_admin()` same). RPC zgłaszającego — w `withServiceRole` jak
 * `submit_content_report`. Błędy bazy są wyjątkami pg (`message`, `code`).
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

type AppealRow = { reference?: unknown; created?: unknown };

function firstRow(rows: AppealRow[]): { reference: string; created: boolean } | null {
  const row = rows[0];
  if (!row || typeof row.reference !== 'string') return null;
  return { reference: row.reference, created: row.created === true };
}

function groundsFailure(message: string): AppealActionResult | null {
  const field = appealFieldFromDbMessage(message);
  return field && field.field === 'grounds'
    ? { ok: false, error: 'VALIDATION_FAILED', field: 'grounds', fieldError: field.error }
    : null;
}

/** Wyjątek przy zapisie odwołania → pole `grounds` albo kod użytkowy; nieznany = INTERNAL (+ Sentry). */
function appealFailure(error: unknown, area: string): AppealActionResult {
  if (!isDatabaseError(error)) {
    captureError(error, { area });
    return { ok: false, error: 'INTERNAL' };
  }
  const message = databaseErrorMessage(error);
  const field = groundsFailure(message);
  if (field) return field;
  const code = mapPgError(message);
  if (code === 'INTERNAL') captureError(error, { area });
  return { ok: false, error: code };
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
  if (!isPortalDataConfigured()) {
    return { ok: true, reference: FIXTURE_APPEAL_REFERENCE, created: true, demo: true };
  }
  if (typeof decisionId !== 'string' || !UUID_RE.test(decisionId)) return { ok: false, error: 'NOT_FOUND' };
  if (!(await checkRateLimit('moderation-appeal', { max: 10, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const rows = await withPortalTransaction(me, (tx) =>
      rpcRows<AppealRow>(tx, 'submit_moderation_appeal', {
        p_decision_id: decisionId,
        p_idempotency_key: idempotencyKey,
        p_grounds: grounds.trim(),
      }),
    );
    const row = firstRow(rows);
    if (!row) {
      captureError(new Error('submit_moderation_appeal: pusta odpowiedź'), { area: 'appeals.submitModeration' });
      return { ok: false, error: 'INTERNAL' };
    }
    return { ok: true, ...row };
  } catch (error) {
    return appealFailure(error, 'appeals.submitModeration');
  }
}

export interface ReportAppealInput {
  caseNumber: string;
  accessCode: string;
  grounds: string;
  idempotencyKey: string;
  /** Od czego odwołanie: wynik sprawy (brak działań, domyślnie) albo cofnięcie ograniczenia. */
  target?: 'decision' | 'restoration';
}

/** Odwołanie zgłaszającego od braku działań albo od cofnięcia ograniczenia (strona sprawy). */
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
  const target = input.target ?? 'decision';
  if (target !== 'decision' && target !== 'restoration') return { ok: false, error: 'VALIDATION_FAILED' };

  if (!isServiceDatabaseConfigured()) {
    if (isReportFixtureMode()) {
      const fixtureCase = target === 'restoration' ? FIXTURE_RESTORED_CASE_NUMBER : FIXTURE_DISMISSED_CASE_NUMBER;
      return lookup.data.caseNumber === fixtureCase
        ? { ok: true, reference: FIXTURE_APPEAL_REFERENCE, created: true }
        : { ok: false, error: 'NOT_FOUND' };
    }
    return { ok: false, error: 'DEMO_UNAVAILABLE' };
  }

  try {
    const rows = await withServiceRole((tx) =>
      rpcRows<AppealRow>(tx, target === 'restoration' ? 'submit_report_restoration_appeal' : 'submit_report_appeal', {
        p_case_number: lookup.data.caseNumber,
        p_access_code: lookup.data.accessCode,
        p_idempotency_key: input.idempotencyKey,
        p_grounds: input.grounds.trim(),
      }),
    );
    const row = firstRow(rows);
    if (!row) {
      captureError(new Error('submit_report_appeal: pusta odpowiedź'), { area: 'appeals.submitReport' });
      return { ok: false, error: 'INTERNAL' };
    }
    return { ok: true, ...row };
  } catch (error) {
    return appealFailure(error, 'appeals.submitReport');
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

  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (!UUID_RE.test(appealId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'admin_decide_appeal', {
        p_appeal_id: appealId,
        p_expected_status: expectedStatus,
        p_outcome: input.outcome,
        p_reasoning: input.reasoning.trim(),
        p_new_decision: restricts ? (input.decision ?? null) : null,
        p_ground_type: restricts ? (input.groundType ?? null) : null,
        p_ground_reference: restricts ? (input.groundReference ?? '').trim() : null,
      }),
    );
    return { ok: true };
  } catch (error) {
    if (!isDatabaseError(error)) {
      captureError(error, { area: 'appeals.decide' });
      return { ok: false, error: 'INTERNAL' };
    }
    const message = databaseErrorMessage(error);
    const field = message.includes('VALIDATION_FAILED') ? appealFieldFromDbMessage(message) : null;
    if (field && field.field !== 'grounds') {
      return { ok: false, error: 'VALIDATION_FAILED', field: field.field, fieldError: field.error };
    }
    const code = mapPgError(message);
    if (code === 'INTERNAL') captureError(error, { area: 'appeals.decide' });
    return { ok: false, error: code };
  }
}
