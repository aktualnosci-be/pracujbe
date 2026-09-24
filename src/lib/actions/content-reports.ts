'use server';

import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import {
  contentReportSchema,
  reportCaseLookupSchema,
  type ContentReportInput,
  type ReportCaseLookupInput,
} from '@/lib/validation/content-report';
import {
  FIXTURE_CASE_NUMBER,
  fixtureReportCase,
  isReportFixtureMode,
  parseReportCase,
  type ReportCaseView,
} from '@/lib/content-reports/case';

/**
 * Publiczne zgłoszenie treści (DSA, #41) — cienka warstwa nad RPC `submit_content_report`
 * (0094). Kolejność: limiter (IP) → Turnstile (polityka `report`: fail-closed) → walidacja
 * Zod → tożsamość z sesji (gość = null) → RPC service_role. Idempotencja, limit per adres,
 * dowód, historia i e-mail potwierdzenia są w bazie.
 *
 * RPC ma EXECUTE tylko dla service_role: gdyby był dostępny dla anon, PostgREST pozwalałby
 * ominąć Turnstile i limiter. `reporterId` podaje serwer z sesji — nigdy klient.
 */

export type SubmitContentReportResult =
  | { ok: true; caseNumber: string; created: boolean }
  | { ok: false; error: ErrorCode };

export type LookupReportCaseResult =
  | { ok: true; report: ReportCaseView }
  | { ok: false; error: ErrorCode };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Komunikat błędu Postgresa → kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  return 'INTERNAL';
}

/** Id zalogowanego użytkownika albo null (gość). Błąd odczytu sesji = zgłoszenie jako gość. */
async function sessionUserId(): Promise<string | null> {
  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch (error) {
    captureError(error, { area: 'contentReport.session' });
    return null;
  }
}

export async function submitContentReport(
  input: ContentReportInput,
  botCheckToken?: string | null,
): Promise<SubmitContentReportResult> {
  if (!(await checkRateLimit('content-report', { max: 10, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  const botCheck = await enforceTurnstile('report', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  const parsed = contentReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  if (!isSupabaseConfigured()) {
    // Serwer fixture E2E: formularz działa bez bazy (nigdy w buildzie produkcyjnym).
    if (isReportFixtureMode()) return { ok: true, caseNumber: FIXTURE_CASE_NUMBER, created: true };
    return { ok: false, error: 'DEMO_UNAVAILABLE' };
  }

  // Identyfikator spoza bazy (np. oferta przykładowa) = nieistniejąca treść, jak w RPC.
  if (!UUID_RE.test(v.jobId)) return { ok: false, error: 'NOT_FOUND' };

  try {
    const reporterId = await sessionUserId();
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('submit_content_report', {
      p_reporter_id: reporterId,
      p_idempotency_key: v.idempotencyKey,
      p_access_code: v.accessCode,
      p_target_type: v.target,
      p_job_id: v.jobId,
      p_category: v.category,
      p_details: v.details,
      p_content_url: v.contentUrl || null,
      p_reporter_name: v.reporterName || null,
      p_reporter_email: v.reporterEmail,
      p_locale: v.locale,
      p_good_faith: v.goodFaith === true,
    });
    if (error) {
      const code = mapPgError(error.message);
      if (code === 'INTERNAL') captureError(error, { area: 'contentReport.submit' });
      return { ok: false, error: code };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { case_number?: unknown; created?: unknown }
      | null
      | undefined;
    if (!row || typeof row.case_number !== 'string') {
      captureError(new Error('submit_content_report: pusta odpowiedź'), { area: 'contentReport.submit' });
      return { ok: false, error: 'INTERNAL' };
    }
    return { ok: true, caseNumber: row.case_number, created: row.created === true };
  } catch (error) {
    captureError(error, { area: 'contentReport.submit' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/**
 * Sprawdzenie sprawy po numerze i kodzie dostępu. Zły kod i nieistniejący numer dają ten
 * sam `NOT_FOUND`; wynik zawiera wyłącznie stan sprawy (bez treści i danych osobowych).
 */
export async function lookupReportCase(input: ReportCaseLookupInput): Promise<LookupReportCaseResult> {
  if (!(await checkRateLimit('report-case', { max: 20, windowSeconds: 600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const parsed = reportCaseLookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const { caseNumber, accessCode } = parsed.data;

  if (!isSupabaseConfigured()) {
    if (isReportFixtureMode()) {
      return caseNumber === FIXTURE_CASE_NUMBER
        ? { ok: true, report: fixtureReportCase() }
        : { ok: false, error: 'NOT_FOUND' };
    }
    return { ok: false, error: 'DEMO_UNAVAILABLE' };
  }

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_report_case', {
      p_case_number: caseNumber,
      p_access_code: accessCode,
    });
    if (error) {
      captureError(error, { area: 'contentReport.lookup' });
      return { ok: false, error: 'INTERNAL' };
    }
    const report = parseReportCase(data);
    return report ? { ok: true, report } : { ok: false, error: 'NOT_FOUND' };
  } catch (error) {
    captureError(error, { area: 'contentReport.lookup' });
    return { ok: false, error: 'INTERNAL' };
  }
}
