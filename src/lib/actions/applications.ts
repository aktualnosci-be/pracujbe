'use server';

import { randomUUID } from 'node:crypto';

import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  applicationPhoneSchema,
  applicationSchema,
  type ApplicationInput,
} from '@/lib/validation/application';

/**
 * Server Actions procesu aplikowania — cienka warstwa nad bezpiecznymi RPC (0012).
 * Cała logika domenowa (idempotencja, powiązania, historia, kolejka e-mail) jest w DB;
 * tu: walidacja Zod + wywołanie RPC + mapowanie błędu na kod użytkowy (bez technikaliów).
 */

/**
 * `field` wskazuje pole formularza, którego dotyczy błąd walidacji (komunikat przy polu).
 * `UNAUTHENTICATED` (brak sesji) jest odróżniony od `PERMISSION_DENIED` (zalogowany, ale nie
 * kandydat), aby link „Zaloguj się” widział tylko ktoś bez sesji (#361).
 */
export type ApplyResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: ErrorCode | 'UNAUTHENTICATED';
      field?: 'phone';
      /** #101: pytanie wymagane bez odpowiedzi (walidacja w bazie) — komunikat przy pytaniu. */
      questionId?: string;
    };

const SCREENING_REQUIRED_RE =
  /SCREENING_ANSWER_REQUIRED: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
export type TransitionResult = { ok: true } | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('COMPANY_NOT_VERIFIED')) return 'COMPANY_NOT_VERIFIED';
  // apply_to_job (0094): brak odpowiedzi na pytanie wymagane.
  if (m.includes('SCREENING_ANSWER_REQUIRED')) return 'SCREENING_ANSWER_REQUIRED';
  // apply_to_job (0071): nowa próba na ofertę, na którą kandydat już aplikował (inny klucz).
  if (m.includes('APPLICATION_ALREADY_EXISTS')) return 'APPLICATION_ALREADY_EXISTS';
  if (m.includes('JOB_NOT_ACTIVE')) return 'JOB_NOT_ACTIVE';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  // transition_application (0040): przejście spoza macierzy albo wyścig (CAS). Użytkownik niczego
  // nie wpisywał, więc nie mówimy „sprawdź dane" — osobny kod z jasnym komunikatem (#306).
  if (m.includes('niedozwolone przejście') || m.includes('zmienił się równolegle')) {
    return 'INVALID_TRANSITION';
  }
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/** Kandydat aplikuje na ofertę (idempotentnie). */
export async function applyToJob(input: ApplicationInput): Promise<ApplyResult> {
  // Rate limit per IP (20 aplikacji / godz) — ochrona przed spamowaniem ofert.
  if (!(await checkRateLimit('apply', { max: 20, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  // Telefon najpierw: błędny numer (#145) wraca jako błąd pola, a nie ogólny komunikat.
  const phone = applicationPhoneSchema.safeParse({
    phone: input.phone,
    phoneCountry: input.phoneCountry,
  });
  if (!phone.success) return { ok: false, error: 'VALIDATION_FAILED', field: 'phone' };

  // Tryb demo (bez bazy): oferty mają syntetyczne identyfikatory i nic nie zapisujemy.
  if (!isSupabaseConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('apply_to_job', {
    p_job_id: v.jobId,
    p_idempotency_key: v.idempotencyKey ?? randomUUID(),
    p_phone: v.phone ? v.phone : null,
    p_availability: v.availability ?? null,
    p_message: v.message ?? null,
    // #101: odpowiedzi zapisywane w tej samej transakcji co aplikacja (walidacja w bazie).
    p_answers: v.answers && Object.keys(v.answers).length > 0 ? v.answers : null,
  });

  if (error) {
    // RPC rzuca 'UNAUTHENTICATED' tylko przy braku sesji; konto innej roli dostaje PERMISSION_DENIED.
    if ((error.message ?? '').startsWith('UNAUTHENTICATED')) {
      return { ok: false, error: 'UNAUTHENTICATED' };
    }
    const code = mapPgError(error.message);
    const questionId = SCREENING_REQUIRED_RE.exec(error.message ?? '')?.[1];
    return questionId ? { ok: false, error: code, questionId } : { ok: false, error: code };
  }
  return { ok: true, id: String(data) };
}

/** Pracodawca zmienia status aplikacji (allow-lista przejść egzekwowana w RPC). */
export async function transitionApplication(
  applicationId: string,
  target: string,
): Promise<TransitionResult> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc('transition_application', {
    p_application_id: applicationId,
    p_target: target,
  });
  if (error) return { ok: false, error: mapPgError(error.message) };
  return { ok: true };
}
