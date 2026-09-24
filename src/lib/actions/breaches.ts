'use server';

import {
  BREACH_LIMITS,
  breachFieldFromDbMessage,
  breachFormErrors,
  breachNoteError,
  breachNotReadyField,
  normalizeBreachForm,
  parseBreachRecipients,
  type BreachFieldError,
  type BreachFormErrors,
} from '@/lib/admin/breach';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { isLocale } from '@/i18n/routing';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Server Actions rejestru incydentów i naruszeń danych osobowych (#490) — panel admina.
 *
 * Każdy zapis to jedno RPC pod SESJĄ administratora (SECURITY DEFINER, `is_admin()`, audyt,
 * niezmienna historia — migracja 0105). Walidacja pól jak w bazie (`breachFormErrors`);
 * błąd pola z bazy (`VALIDATION_FAILED: <pole>:<kod>`) wraca do formularza przy polu.
 * Klucz idempotencji (`clientKey`) tworzy przeglądarka raz na operację — podwójne kliknięcie
 * i ponowienie po błędzie sieci nie tworzą drugiego wpisu ani drugiej wysyłki.
 *
 * Bez env → tryb DEMO (`{ ok: true, demo: true }`), nic nie jest zapisywane.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Błąd specyficzny dla rejestru (komunikat z namespace `admin`). */
export type BreachProblem = 'closed' | 'notReady' | 'notifyNotDecided';

export type BreachActionResult<T extends object = Record<never, never>> =
  | ({ ok: true; demo?: boolean } & Partial<T>)
  | {
      ok: false;
      error: ErrorCode;
      fields?: BreachFormErrors;
      /** Błąd pola spoza formularza wpisu (uzasadnienie zamknięcia, treść zawiadomienia). */
      field?: string;
      fieldError?: BreachFieldError;
      problem?: BreachProblem;
      /** Brakujący krok przed zamknięciem (pole formularza). */
      missing?: string;
    };

function mapError(message: string | undefined): BreachActionResult {
  const m = message ?? '';
  if (m.includes('STALE_STATE')) return { ok: false, error: 'STALE_STATE' };
  if (m.includes('BREACH_CLOSED')) return { ok: false, error: 'VALIDATION_FAILED', problem: 'closed' };
  if (m.includes('BREACH_NOTIFY_NOT_DECIDED')) {
    return { ok: false, error: 'VALIDATION_FAILED', problem: 'notifyNotDecided' };
  }
  const notReady = breachNotReadyField(m);
  if (notReady) return { ok: false, error: 'VALIDATION_FAILED', problem: 'notReady', missing: notReady };
  const field = breachFieldFromDbMessage(m);
  if (field) return { ok: false, error: 'VALIDATION_FAILED', field: field.field, fieldError: field.error };
  if (m.includes('NOT_FOUND')) return { ok: false, error: 'NOT_FOUND' };
  if (m.includes('VALIDATION_FAILED')) return { ok: false, error: 'VALIDATION_FAILED' };
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('permission denied')) {
    return { ok: false, error: 'PERMISSION_DENIED' };
  }
  return { ok: false, error: 'INTERNAL' };
}

/** Błąd pola formularza wpisu z bazy → `fields`, żeby formularz pokazał go przy polu. */
function withFormField(result: BreachActionResult): BreachActionResult {
  if (!result.ok && result.field && result.fieldError) {
    return { ...result, fields: { [result.field]: result.fieldError } as BreachFormErrors };
  }
  return result;
}

async function sessionClient() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

function validForm(input: unknown) {
  const form = normalizeBreachForm(input);
  const fields = breachFormErrors(form);
  return { form, fields, valid: Object.keys(fields).length === 0 };
}

/** Nowy wpis rejestru. Zwraca identyfikator (także przy ponowieniu z tym samym kluczem). */
export async function createBreachIncident(
  clientKey: string,
  input: unknown,
): Promise<BreachActionResult<{ id: string }>> {
  const { form, fields, valid } = validForm(input);
  if (!valid) return { ok: false, error: 'VALIDATION_FAILED', fields };
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (typeof clientKey !== 'string' || !UUID_RE.test(clientKey)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  try {
    const supabase = await sessionClient();
    if (!supabase) return { ok: false, error: 'PERMISSION_DENIED' };
    const { data, error } = await supabase.rpc('admin_create_breach_incident', {
      p_client_key: clientKey,
      p_data: form,
    });
    if (error) return withFormField(mapError(error.message));
    return typeof data === 'string' ? { ok: true, id: data } : { ok: false, error: 'INTERNAL' };
  } catch (e) {
    captureError(e, { area: 'admin.createBreachIncident' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Edycja wpisu (CAS po wersji widzianej przez admina → `STALE_STATE`). */
export async function updateBreachIncident(
  id: string,
  expectedVersion: number,
  input: unknown,
): Promise<BreachActionResult<{ version: number }>> {
  const { form, fields, valid } = validForm(input);
  if (!valid) return { ok: false, error: 'VALIDATION_FAILED', fields };
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (typeof id !== 'string' || !UUID_RE.test(id) || !Number.isInteger(expectedVersion)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  try {
    const supabase = await sessionClient();
    if (!supabase) return { ok: false, error: 'PERMISSION_DENIED' };
    const { data, error } = await supabase.rpc('admin_update_breach_incident', {
      p_id: id,
      p_expected_version: expectedVersion,
      p_data: form,
    });
    if (error) return withFormField(mapError(error.message));
    return typeof data === 'number' ? { ok: true, version: data } : { ok: false, error: 'INTERNAL' };
  } catch (e) {
    captureError(e, { area: 'admin.updateBreachIncident' });
    return { ok: false, error: 'INTERNAL' };
  }
}

async function transition(
  rpc: 'admin_close_breach_incident' | 'admin_reopen_breach_incident',
  id: string,
  expectedVersion: number,
  note: string,
  field: 'closureSummary' | 'reason',
): Promise<BreachActionResult> {
  const max = field === 'closureSummary' ? BREACH_LIMITS.closureSummary : BREACH_LIMITS.reopenReason;
  const noteError = breachNoteError(typeof note === 'string' ? note : '', max);
  if (noteError) return { ok: false, error: 'VALIDATION_FAILED', field, fieldError: noteError };
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (typeof id !== 'string' || !UUID_RE.test(id) || !Number.isInteger(expectedVersion)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  try {
    const supabase = await sessionClient();
    if (!supabase) return { ok: false, error: 'PERMISSION_DENIED' };
    const args =
      rpc === 'admin_close_breach_incident'
        ? { p_id: id, p_expected_version: expectedVersion, p_summary: note.trim() }
        : { p_id: id, p_expected_version: expectedVersion, p_reason: note.trim() };
    const { error } = await supabase.rpc(rpc, args);
    if (error) return mapError(error.message);
    return { ok: true };
  } catch (e) {
    captureError(e, { area: `admin.${rpc}` });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Zamknięcie wpisu z podsumowaniem (naruszenie: po udokumentowaniu oceny i decyzji). */
export async function closeBreachIncident(
  id: string,
  expectedVersion: number,
  summary: string,
): Promise<BreachActionResult> {
  return transition('admin_close_breach_incident', id, expectedVersion, summary, 'closureSummary');
}

/** Ponowne otwarcie zamkniętego wpisu z powodem (np. nowe ustalenia). */
export async function reopenBreachIncident(
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<BreachActionResult> {
  return transition('admin_reopen_breach_incident', id, expectedVersion, reason, 'reason');
}

export interface BreachNoticeInput {
  recipients: string;
  /** Treść per język: `{ pl: { subject, body }, … }`; puste języki pomijamy. */
  content: Record<string, { subject?: string; body?: string }>;
}

export type BreachNoticeResult =
  | { ok: true; demo?: boolean; recipients?: number; queued?: number }
  | {
      ok: false;
      error: ErrorCode;
      problem?: BreachProblem;
      field?: string;
      fieldError?: BreachFieldError;
      malformed?: string[];
      unknown?: string[];
      unknownCount?: number;
      missingLocales?: string[];
    };

/**
 * Zawiadomienie dotkniętych osób przez kolejkę e-mail (#490). Treść wpisuje administrator;
 * baza wybiera wersję w języku KAŻDEGO odbiorcy (Invariant #1) i odrzuca wysyłkę, gdy
 * brakuje treści w którymś z tych języków. Zakolejkowanie ≠ doręczenie.
 */
export async function notifyBreachSubjects(
  id: string,
  clientKey: string,
  input: BreachNoticeInput,
): Promise<BreachNoticeResult> {
  const text = typeof input?.recipients === 'string' ? input.recipients : '';
  const { entries, malformed } = parseBreachRecipients(text);
  if (malformed.length > 0) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'recipients', fieldError: 'invalid', malformed: malformed.slice(0, 50) };
  }
  if (entries.length === 0) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'recipients', fieldError: 'required' };
  }
  if (entries.length > BREACH_LIMITS.recipients) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'recipients', fieldError: 'tooLong' };
  }

  const content: Record<string, { subject: string; body: string }> = {};
  const raw = typeof input?.content === 'object' && input.content !== null ? input.content : {};
  for (const [locale, value] of Object.entries(raw)) {
    if (!isLocale(locale)) continue;
    const subject = typeof value?.subject === 'string' ? value.subject.trim() : '';
    const body = typeof value?.body === 'string' ? value.body.trim() : '';
    if (subject.length === 0 && body.length === 0) continue;
    if (subject.length === 0 || subject.length > BREACH_LIMITS.noticeSubject) {
      return { ok: false, error: 'VALIDATION_FAILED', field: `subject_${locale}`, fieldError: subject ? 'tooLong' : 'required' };
    }
    if (body.length === 0 || body.length > BREACH_LIMITS.noticeBody) {
      return { ok: false, error: 'VALIDATION_FAILED', field: `body_${locale}`, fieldError: body ? 'tooLong' : 'required' };
    }
    content[locale] = { subject, body };
  }
  if (Object.keys(content).length === 0) {
    return { ok: false, error: 'VALIDATION_FAILED', field: 'content', fieldError: 'required' };
  }

  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (typeof id !== 'string' || !UUID_RE.test(id) || typeof clientKey !== 'string' || !UUID_RE.test(clientKey)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  try {
    const supabase = await sessionClient();
    if (!supabase) return { ok: false, error: 'PERMISSION_DENIED' };
    const { data, error } = await supabase.rpc('admin_notify_breach_subjects', {
      p_id: id,
      p_client_key: clientKey,
      p_recipients: entries,
      p_content: content,
    });
    if (error) {
      const mapped = mapError(error.message);
      return mapped.ok ? { ok: false, error: 'INTERNAL' } : mapped;
    }
    const result = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    if (result['status'] === 'invalid') {
      const list = (value: unknown) =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
      return {
        ok: false,
        error: 'VALIDATION_FAILED',
        unknown: list(result['unknown']),
        unknownCount: typeof result['unknownCount'] === 'number' ? result['unknownCount'] : 0,
        missingLocales: list(result['missingLocales']),
      };
    }
    if (result['status'] !== 'queued') return { ok: false, error: 'INTERNAL' };
    return {
      ok: true,
      recipients: typeof result['recipients'] === 'number' ? result['recipients'] : 0,
      queued: typeof result['queued'] === 'number' ? result['queued'] : 0,
    };
  } catch (e) {
    captureError(e, { area: 'admin.notifyBreachSubjects' });
    return { ok: false, error: 'INTERNAL' };
  }
}
