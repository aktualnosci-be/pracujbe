'use server';

import { createServerClient } from '@/lib/supabase/server';
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
import { isSupabaseConfigured } from '@/lib/env';
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
 *   - `checkCompanyVies` — ręczne sprawdzenie numeru VAT firmy w VIES (#92), zapis wyniku
 *     rozstrzygającego przez RPC `admin_record_vies_check` (0088).
 *
 * Oba RPC (0081, #420) egzekwują macierz przejść (`INVALID_TRANSITION`) i porównują status
 * widziany przez admina z bieżącym (`p_expected_status`, `FOR UPDATE` → `STALE_STATE`, gdy
 * inny admin zmienił go w międzyczasie).
 *
 * Zapis idzie pod SESJĄ użytkownika (`createServerClient`), bo RPC są `SECURITY DEFINER`
 * i wewnętrznie sprawdzają `is_admin()` na `auth.uid()` — service-role NIE nadaje się tu
 * (nie ma tożsamości admina). Walidacja wartości statusów po stronie akcji (allow-lista),
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

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_set_company_status', {
      p_company_id: companyId,
      p_status: status,
      p_expected_status: expectedStatus,
      p_reason: needsReason ? trimmedReason : null,
    });
    if (error) {
      const message = error.message ?? '';
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

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_resolve_report', {
      p_report_id: reportId,
      p_status: status,
      p_expected_status: expectedStatus,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

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
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (typeof suppressionId !== 'string' || !UUID_RE.test(suppressionId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_lift_email_suppression', {
      p_id: suppressionId,
      p_reason: reason.trim(),
    });
    if (error) {
      const message = error.message ?? '';
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
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (!UUID_RE.test(reportId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_decide_report', {
      p_report_id: reportId,
      p_expected_status: expectedStatus,
      p_decision: decision,
      p_facts: input.facts.trim(),
      p_ground_type: restricts ? (input.groundType ?? null) : null,
      p_ground_reference: restricts ? (input.groundReference ?? '').trim() : null,
      p_automated_detection: input.automatedDetection === true,
    });
    if (error) {
      const message = error.message ?? '';
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

  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (!UUID_RE.test(decisionId)) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_restore_moderation', {
      p_decision_id: decisionId,
      p_reason: reason.trim(),
    });
    if (error) {
      const message = error.message ?? '';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ręczne sprawdzenie numeru VAT firmy w VIES (#92) — informacja dla admina.
 *
 * Kolejność: sesja + rola admina (zanim cokolwiek trafi do VIES) → numer firmy (service-role)
 * → adapter VIES (timeout, ponowienia) → zapis TYLKO wyniku rozstrzygającego (`valid` /
 * `invalid`) przez RPC pod sesją admina. Niedostępność i limit VIES wracają do admina jako
 * osobne stany i nie są zapisywane — nigdy nie nadpisują wcześniejszego wyniku i nigdy nie
 * oznaczają numeru jako nieważnego. Status firmy się nie zmienia (bez automatycznego
 * odrzucania). Logujemy wyłącznie obszar błędu — bez numeru, nazwy i odpowiedzi VIES.
 */
export async function checkCompanyVies(companyId: string): Promise<ViesActionResult> {
  // Tryb DEMO: VIES nie jest odpytywany (żadnych zapytań sieciowych bez backendu).
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if ((profile as { role?: unknown } | null)?.role !== 'admin') {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { data: company, error: companyError } = await createAdminClient()
      .from('companies')
      .select('id, name, vat_number, registration_number')
      .eq('id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) return { ok: false, error: 'NOT_FOUND' };
    const row = company as {
      name?: string | null;
      vat_number?: string | null;
      registration_number?: string | null;
    };

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

    const { error: saveError } = await supabase.rpc('admin_record_vies_check', {
      p_company_id: companyId,
      p_vat_number: result.vatNumber,
      p_result: result.status,
      p_vies_name: result.status === 'valid' ? result.name : null,
      p_request_date: result.requestDate,
    });
    if (saveError) {
      captureError(new Error(`admin_record_vies_check: ${mapPgError(saveError.message)}`), {
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
