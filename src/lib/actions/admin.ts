'use server';

import { companyReasonError, companyStatusNeedsReason } from '@/lib/admin/company-review';
import { emailLiftReasonError } from '@/lib/admin/email-suppression';
import {
  decisionRestricts,
  isModerationDecision,
  moderationDecisionError,
  moderationFieldFromDbMessage,
  restoreReasonError,
  type ModerationDecisionInput,
  type ModerationField,
  type ModerationFieldError,
} from '@/lib/admin/moderation';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction, withServiceRole } from '@/lib/db/portal';
import { queryOne, rpc, type RpcArgs } from '@/lib/db/sql';
import {
  isScreeningReviewDecision,
  screeningReviewReasonError,
  type ScreeningReviewDecision,
} from '@/lib/screening/review';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
import { checkBelgianVatInVies, type ViesCheckResult } from '@/lib/vies/client';
import { compareCompanyNames, type CompanyNameComparison } from '@/lib/vies/name-match';
import { companyVatSource } from '@/lib/vies/state';

/**
 * Server Actions panelu administratora — Pracuj.be (Etap 7g).
 *
 *   - `setCompanyStatus` — zmienia status weryfikacji firmy przez RPC `admin_set_company_status`
 *     (odrzucenie/zawieszenie z wymaganym uzasadnieniem — 0084, #310).
 *   - `resolveReport`    — rozstrzyga zgłoszenie przez RPC `admin_resolve_report` (sprawę DSA
 *     tylko bierze do analizy — rozstrzyga ją decyzja).
 *   - `decideReport`     — decyzja moderacyjna w sprawie DSA (#42): RPC `admin_decide_report`
 *     (decyzja + skutek + stan sprawy + audyt + powiadomienia w jednej transakcji, 0099).
 *   - `restoreModeration` — cofnięcie ograniczenia treści (RPC `admin_restore_moderation`).
 *   - `liftEmailSuppression` — zdjęcie blokady adresu e-mail (#44) przez RPC
 *     `admin_lift_email_suppression` (0098, uzasadnienie wymagane, audyt).
 *   - `decideScreeningReview` — decyzja o pytaniu screeningowym oznaczonym przez detektor
 *     (#497) przez RPC `admin_decide_screening_review` (0103: tylko oczekujące, odrzucenie
 *     z uzasadnieniem, audyt, powiadomienie firmy). Akceptacja nie publikuje oferty.
 *   - `checkCompanyVies` — ręczne sprawdzenie numeru VAT firmy w VIES (#92), zapis wyniku
 *     rozstrzygającego przez RPC `admin_record_vies_check` (0088).
 *
 * Oba RPC (0081, #420) egzekwują macierz przejść (`INVALID_TRANSITION`) i porównują status
 * widziany przez admina z bieżącym (`p_expected_status`, `FOR UPDATE` → `STALE_STATE`, gdy
 * inny admin zmienił go w międzyczasie).
 *
 * Zapis idzie pod SESJĄ użytkownika (`withPortalTransaction` z tożsamością z
 * `getPortalIdentity()`, rola `authenticated`, `auth.uid()` = admin), bo RPC są
 * `SECURITY DEFINER` i wewnętrznie sprawdzają `is_admin()` na `auth.uid()` — service-role NIE
 * nadaje się tu (nie ma tożsamości admina). Błędy bazy to wyjątki pg (`message`, `code`). Walidacja wartości statusów po stronie akcji (allow-lista),
 * błędy Postgresa mapowane na stabilny `ErrorCode` (Invariant #8). Bez env → tryb DEMO
 * (`{ ok: true, demo: true }`), by build/UX działały bez backendu.
 */

export type AdminActionResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode; field?: 'reason'; reason?: 'required' | 'tooLong' };

const COMPANY_STATUSES = ['unverified', 'pending', 'verified', 'rejected', 'suspended'] as const;
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('STALE_STATE')) return 'STALE_STATE';
  if (m.includes('MODERATION_LOCKED')) return 'MODERATION_LOCKED';
  if (m.includes('INVALID_TRANSITION')) return 'INVALID_TRANSITION';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED') || m.includes('invalid input value')) return 'VALIDATION_FAILED';
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

type AdminRpcCall = { status: 'ok' } | { status: 'unauthenticated' } | { status: 'db_error'; message: string };

/**
 * RPC `admin_*` pod sesją bieżącego użytkownika (RLS/`is_admin()` decyduje w bazie). Błąd bazy
 * wraca jako komunikat do mapowania na kod użytkowy; wyjątek spoza bazy (sieć, konfiguracja)
 * rzuca dalej — trafia do Sentry w akcji.
 */
async function callAdminRpc(fn: string, args: RpcArgs): Promise<AdminRpcCall> {
  const me = await getPortalIdentity();
  if (!me) return { status: 'unauthenticated' };
  try {
    await withPortalTransaction(me, (tx) => rpc(tx, fn, args));
    return { status: 'ok' };
  } catch (error) {
    if (isDatabaseError(error)) return { status: 'db_error', message: databaseErrorMessage(error) };
    throw error;
  }
}

/**
 * Zmienia status weryfikacji firmy (tylko admin — egzekwowane przez RPC). Odrzucenie
 * i zawieszenie wymagają uzasadnienia (`reason`), które trafia do właściciela firmy
 * (powiadomienie + e-mail w JEGO języku) i do dziennika zdarzeń (#310).
 */
export async function setCompanyStatus(
  companyId: string,
  status: string,
  expectedStatus: string,
  reason?: string | null,
): Promise<AdminActionResult> {
  if (
    !companyId ||
    !(COMPANY_STATUSES as readonly string[]).includes(status) ||
    !(COMPANY_STATUSES as readonly string[]).includes(expectedStatus)
  ) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  const needsReason = companyStatusNeedsReason(status);
  const reasonError = companyReasonError(status, trimmedReason);
  if (reasonError) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: reasonError };
  }

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    const call = await callAdminRpc('admin_set_company_status', {
      p_company_id: companyId,
      p_status: status,
      p_expected_status: expectedStatus,
      p_reason: needsReason ? trimmedReason : null,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') {
      const message = call.message;
      if (message.includes('REASON_REQUIRED')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'required' };
      }
      if (message.includes('REASON_TOO_LONG')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'tooLong' };
      }
      return { ok: false, error: mapPgError(message) };
    }

    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.setCompanyStatus' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Rozstrzyga zgłoszenie (tylko admin — egzekwowane przez RPC). */
export async function resolveReport(
  reportId: string,
  status: string,
  expectedStatus: string,
): Promise<AdminActionResult> {
  if (
    !reportId ||
    !(REPORT_STATUSES as readonly string[]).includes(status) ||
    !(REPORT_STATUSES as readonly string[]).includes(expectedStatus)
  ) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  try {
    const call = await callAdminRpc('admin_resolve_report', {
      p_report_id: reportId,
      p_status: status,
      p_expected_status: expectedStatus,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') return { ok: false, error: mapPgError(call.message) };

    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.resolveReport' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/**
 * Zdejmuje blokadę adresu e-mail (#44) — tylko admin (egzekwowane przez RPC `is_admin()`).
 * Uzasadnienie trafia do dziennika zdarzeń. Blokada zdjęta w międzyczasie → `STALE_STATE`.
 */
export async function liftEmailSuppression(
  suppressionId: string,
  reason: string,
): Promise<AdminActionResult> {
  const reasonError = emailLiftReasonError(typeof reason === 'string' ? reason : '');
  if (reasonError) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: reasonError };
  }
  // Tryb DEMO: identyfikatory przykładowych blokad nie są UUID; nic nie zapisujemy.
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (typeof suppressionId !== 'string' || !UUID_RE.test(suppressionId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    const call = await callAdminRpc('admin_lift_email_suppression', {
      p_id: suppressionId,
      p_reason: reason.trim(),
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') {
      const message = call.message;
      if (message.includes('REASON_REQUIRED')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'required' };
      }
      if (message.includes('REASON_TOO_LONG')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'tooLong' };
      }
      return { ok: false, error: mapPgError(message) };
    }
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.liftEmailSuppression' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/**
 * Oznacza wiadomość z formularza kontaktu jako obsłużoną albo przywraca ją do nowych (#61).
 * Tylko admin (RPC `admin_set_contact_message_status`, 0115: CAS po statusie, audyt bez treści).
 */
export async function setContactMessageStatus(
  messageId: string,
  status: 'new' | 'handled',
  expectedStatus: 'new' | 'handled',
): Promise<AdminActionResult> {
  const statuses = ['new', 'handled'];
  if (!statuses.includes(status) || !statuses.includes(expectedStatus)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  // Tryb DEMO: identyfikatory przykładowych wiadomości nie są UUID; nic nie zapisujemy.
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (typeof messageId !== 'string' || !UUID_RE.test(messageId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    const call = await callAdminRpc('admin_set_contact_message_status', {
      p_id: messageId,
      p_status: status,
      p_expected_status: expectedStatus,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') return { ok: false, error: mapPgError(call.message) };
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.setContactMessageStatus' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export type ModerationActionResult =
  | { ok: true; demo?: boolean }
  | {
      ok: false;
      error: ErrorCode;
      field?: ModerationField | 'reason';
      fieldError?: ModerationFieldError;
    };

/**
 * Decyzja moderacyjna w sprawie DSA (#42). Walidacja jak w bazie (`moderationDecisionError`),
 * `expectedStatus` = status widziany przez admina (CAS → `STALE_STATE`). Całość wykonuje jedno
 * RPC w jednej transakcji — akcja nie zapisuje niczego sama.
 */
export async function decideReport(
  reportId: string,
  expectedStatus: string,
  targetType: string,
  input: ModerationDecisionInput,
): Promise<ModerationActionResult> {
  if (typeof reportId !== 'string' || !(REPORT_STATUSES as readonly string[]).includes(expectedStatus)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const invalid = moderationDecisionError(input, targetType);
  if (invalid) {
    return { ok: false, error: 'VALIDATION_FAILED', field: invalid.field, fieldError: invalid.error };
  }
  const decision = input.decision;
  if (!isModerationDecision(decision)) return { ok: false, error: 'VALIDATION_FAILED' };
  const restricts = decisionRestricts(decision);

  // Tryb DEMO (identyfikatory `demo-*`) — bez zapisu; poza nim tylko UUID.
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (!UUID_RE.test(reportId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const call = await callAdminRpc('admin_decide_report', {
      p_report_id: reportId,
      p_expected_status: expectedStatus,
      p_decision: decision,
      p_facts: input.facts.trim(),
      p_ground_type: restricts ? (input.groundType ?? null) : null,
      p_ground_reference: restricts ? (input.groundReference ?? '').trim() : null,
      p_automated_detection: input.automatedDetection === true,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') {
      const message = call.message;
      const field = message.includes('VALIDATION_FAILED') ? moderationFieldFromDbMessage(message) : null;
      if (field) return { ok: false, error: 'VALIDATION_FAILED', field: field.field, fieldError: field.error };
      return { ok: false, error: mapPgError(message) };
    }
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.decideReport' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Cofnięcie ograniczenia treści (tylko admin, uzasadnienie wymagane — trafia do autora). */
export async function restoreModeration(
  decisionId: string,
  reason: string,
): Promise<ModerationActionResult> {
  if (typeof decisionId !== 'string') return { ok: false, error: 'VALIDATION_FAILED' };
  const reasonError = restoreReasonError(reason);
  if (reasonError) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', fieldError: reasonError };
  }

  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (!UUID_RE.test(decisionId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const call = await callAdminRpc('admin_restore_moderation', {
      p_decision_id: decisionId,
      p_reason: reason.trim(),
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') {
      const message = call.message;
      const field = message.includes('VALIDATION_FAILED') ? moderationFieldFromDbMessage(message) : null;
      if (field) return { ok: false, error: 'VALIDATION_FAILED', field: field.field, fieldError: field.error };
      return { ok: false, error: mapPgError(message) };
    }
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.restoreModeration' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export type ViesActionOutcome =
  | Extract<ViesCheckResult, { status: 'format_invalid' | 'invalid' | 'rate_limited' | 'unavailable' }>
  | (Extract<ViesCheckResult, { status: 'valid' }> & { nameMatch: CompanyNameComparison });

export type ViesActionResult =
  | { ok: true; demo: true }
  | { ok: true; demo?: false; outcome: ViesActionOutcome; saved: boolean }
  | { ok: false; error: ErrorCode };

/**
 * Decyzja admina o pytaniu screeningowym (#497). Odrzucenie wymaga uzasadnienia (trafia do
 * firmy w kreatorze i do dziennika zdarzeń); te same reguły egzekwuje RPC.
 */
export async function decideScreeningReview(
  reviewId: string,
  decision: ScreeningReviewDecision,
  reason: string,
): Promise<AdminActionResult> {
  if (!isScreeningReviewDecision(decision)) return { ok: false, error: 'VALIDATION_FAILED' };
  const reasonError = screeningReviewReasonError(decision, typeof reason === 'string' ? reason : '');
  if (reasonError) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: reasonError };
  }
  // Tryb DEMO: identyfikatory przykładowych przeglądów nie są UUID; nic nie zapisujemy.
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (typeof reviewId !== 'string' || !UUID_RE.test(reviewId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    const call = await callAdminRpc('admin_decide_screening_review', {
      p_review_id: reviewId,
      p_decision: decision,
      p_reason: trimmed.length > 0 ? trimmed : null,
    });
    if (call.status === 'unauthenticated') return { ok: false, error: 'PERMISSION_DENIED' };
    if (call.status === 'db_error') {
      const message = call.message;
      if (message.includes('REASON_REQUIRED')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'required' };
      }
      if (message.includes('REASON_TOO_LONG')) {
        return { ok: false, error: 'VALIDATION_FAILED', field: 'reason', reason: 'tooLong' };
      }
      return { ok: false, error: mapPgError(message) };
    }
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.decideScreeningReview' });
    return { ok: false, error: 'INTERNAL' };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ręczne sprawdzenie numeru VAT firmy w VIES (#92) — informacja dla admina.
 *
 * Kolejność: sesja + rola admina (zanim cokolwiek trafi do VIES) → numer firmy (`withServiceRole`)
 * → adapter VIES (timeout, ponowienia) → zapis TYLKO wyniku rozstrzygającego (`valid` /
 * `invalid`) przez RPC pod sesją admina. Niedostępność i limit VIES wracają do admina jako
 * osobne stany i nie są zapisywane — nigdy nie nadpisują wcześniejszego wyniku i nigdy nie
 * oznaczają numeru jako nieważnego. Status firmy się nie zmienia (bez automatycznego
 * odrzucania). Logujemy wyłącznie obszar błędu — bez numeru, nazwy i odpowiedzi VIES.
 */
export async function checkCompanyVies(companyId: string): Promise<ViesActionResult> {
  // Tryb DEMO: VIES nie jest odpytywany (żadnych zapytań sieciowych bez backendu).
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    // Rola z `getPortalIdentity()` (profil już sprawdzony w bazie) — zanim cokolwiek trafi do VIES.
    const me = await getPortalIdentity();
    if (!me || me.role !== 'admin') return { ok: false, error: 'PERMISSION_DENIED' };

    // Jedyny odczyt service_role w akcjach admina — dopiero po potwierdzeniu roli.
    const row = await withServiceRole((tx) =>
      queryOne<{ name: string | null; vat_number: string | null; registration_number: string | null }>(
        tx,
        'admin.vies-company',
        `SELECT id, name, vat_number, registration_number
           FROM public.companies
          WHERE id = $1 AND deleted_at IS NULL`,
        [companyId],
      ),
    );
    if (!row) return { ok: false, error: 'NOT_FOUND' };

    const result = await checkBelgianVatInVies(
      companyVatSource(row.vat_number, row.registration_number),
    );
    if (result.status !== 'valid' && result.status !== 'invalid') {
      return { ok: true, outcome: result, saved: false };
    }

    const outcome: ViesActionOutcome =
      result.status === 'valid'
        ? { ...result, nameMatch: compareCompanyNames(row.name, result.name) }
        : result;

    // Zapis w osobnej, krótkiej transakcji pod sesją admina (bez trzymania połączenia w trakcie
    // zapytania do VIES). Błąd zapisu nie gubi wyniku: wraca do admina z `saved: false`.
    let saveError: ErrorCode | null = null;
    try {
      const call = await callAdminRpc('admin_record_vies_check', {
        p_company_id: companyId,
        p_vat_number: result.vatNumber,
        p_result: result.status,
        p_vies_name: result.status === 'valid' ? result.name : null,
        p_request_date: result.requestDate,
      });
      if (call.status === 'unauthenticated') saveError = 'PERMISSION_DENIED';
      else if (call.status === 'db_error') saveError = mapPgError(call.message);
    } catch {
      saveError = 'INTERNAL';
    }
    if (saveError) {
      captureError(new Error(`admin_record_vies_check: ${saveError}`), {
        area: 'admin.checkCompanyVies.save',
      });
      return { ok: true, outcome, saved: false };
    }
    return { ok: true, outcome, saved: true };
  } catch (e) {
    captureError(e, { area: 'admin.checkCompanyVies' });
    return { ok: false, error: 'INTERNAL' };
  }
}
