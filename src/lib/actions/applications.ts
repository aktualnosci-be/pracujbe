'use server';

import { randomUUID } from 'node:crypto';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import {
  applicationPhoneSchema,
  applicationSchema,
  findPersonalIdentifierField,
  type ApplicationInput,
} from '@/lib/validation/application';

/**
 * Server Actions procesu aplikowania — cienka warstwa nad bezpiecznymi RPC (0012).
 * Cała logika domenowa (idempotencja, powiązania, historia, kolejka e-mail) jest w DB;
 * tu: walidacja Zod + wywołanie RPC w transakcji sesji (`withPortalTransaction`, #25) +
 * mapowanie błędu bazy na kod użytkowy (bez technikaliów, Invariant #8).
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
      field?: 'phone' | 'message';
      /** #101: pytanie wymagane bez odpowiedzi (walidacja w bazie) — komunikat przy pytaniu. */
      questionId?: string;
      /** #495: pole/pytanie zawiera NISS/BIS albo numer dokumentu — komunikat przy polu. */
      reason?: 'sensitiveId';
    };

const SCREENING_REQUIRED_RE =
  /SCREENING_ANSWER_REQUIRED: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
export type TransitionResult = { ok: true } | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('COMPANY_NOT_VERIFIED')) return 'COMPANY_NOT_VERIFIED';
  // apply_to_job (0093): brak odpowiedzi na pytanie wymagane.
  if (m.includes('SCREENING_ANSWER_REQUIRED')) return 'SCREENING_ANSWER_REQUIRED';
  // 0126 (#492): kandydat bez ważnej deklaracji progu wieku (np. po podniesieniu progu).
  if (m.includes('AGE_ATTESTATION_REQUIRED')) return 'AGE_ATTESTATION_REQUIRED';
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

  // #495: NISS/BIS, PESEL ani numer dokumentu nie są potrzebne do aplikowania — odmowa przy
  // polu, zanim cokolwiek trafi do bazy (sprawdza też `applicationSchema`).
  const sensitive = findPersonalIdentifierField(input);
  if (sensitive) return { ok: false, error: 'VALIDATION_FAILED', reason: 'sensitiveId', ...sensitive };

  // Tryb demo (bez bazy): oferty mają syntetyczne identyfikatory i nic nie zapisujemy.
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  try {
    // Brak sesji = UNAUTHENTICATED (link logowania); konto innej roli dostaje PERMISSION_DENIED z RPC.
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'UNAUTHENTICATED' };
    const data = await withPortalTransaction(me, (tx) => rpc(tx, 'apply_to_job', {
      p_job_id: v.jobId,
      p_idempotency_key: v.idempotencyKey ?? randomUUID(),
      p_phone: v.phone ? v.phone : null,
      p_availability: v.availability ?? null,
      p_message: v.message ?? null,
      // #101: odpowiedzi zapisywane w tej samej transakcji co aplikacja (walidacja w bazie).
      p_answers: v.answers && Object.keys(v.answers).length > 0 ? jsonArg(v.answers) : null,
    }));
    return { ok: true, id: String(data) };
  } catch (error) {
    if (!isDatabaseError(error)) {
      captureError(error, { area: 'applications.applyToJob' });
      return { ok: false, error: 'INTERNAL' };
    }
    const message = databaseErrorMessage(error);
    // RPC rzuca 'UNAUTHENTICATED' tylko przy braku sesji; konto innej roli dostaje PERMISSION_DENIED.
    if (message.startsWith('UNAUTHENTICATED')) return { ok: false, error: 'UNAUTHENTICATED' };
    const code = mapPgError(message);
    const questionId = SCREENING_REQUIRED_RE.exec(message)?.[1];
    return questionId ? { ok: false, error: code, questionId } : { ok: false, error: code };
  }
}

/** Pracodawca zmienia status aplikacji (allow-lista przejść egzekwowana w RPC). */
export async function transitionApplication(
  applicationId: string,
  target: string,
): Promise<TransitionResult> {
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) => rpc(tx, 'transition_application', {
      p_application_id: applicationId,
      p_target: target,
    }));
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'applications.transitionApplication' });
    return { ok: false, error: 'INTERNAL' };
  }
}
