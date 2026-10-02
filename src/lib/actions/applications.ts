'use server';

import { randomUUID } from 'node:crypto';

import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc, rpcRows } from '@/lib/db/sql';
import { z } from 'zod';

import { MENU_TARGET_STATUSES } from '@/lib/applications/transitions';
import {
  BULK_TRANSITION_MAX,
  BULK_TRANSITION_OUTCOMES,
  TRANSITION_RATE_LIMITS,
  type BulkTransitionOutcome,
} from '@/lib/applications/bulk';
import { getExpectedActiveCompany } from '@/lib/company-context';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
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
  // #1140 (0171): baza w trybie ogłoszeniowym odrzuca nowe dane procesu rekrutacyjnego.
  if (m.includes('RECRUITMENT_DISABLED')) return 'RECRUITMENT_DISABLED';
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
  // #1130/#1144 — decyzja produktowa: portal ogłoszeniowy. Przed walidacją, limiterem i bazą.
  if (!isRecruitmentEnabled('applications')) return { ok: false, error: 'RECRUITMENT_DISABLED' };
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

  // #852: sesja PRZED limitem — anonimowe wywołanie (bez konta) nie może zużyć wspólnego
  // budżetu IP/NAT i zablokować prawdziwych kandydatów za tym samym adresem. Brak sesji =
  // UNAUTHENTICATED (link logowania w modalu), bez dotykania jakiegokolwiek licznika.
  const me = await getPortalIdentity();
  if (!me) return { ok: false, error: 'UNAUTHENTICATED' };

  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  // Limit biznesowy PER KONTO (20 aplikacji / godz), niezależny od IP (#852): dwa konta za
  // tym samym adresem (NAT/CGNAT, biuro, dom) mają niezależne budżety, a jedno konto nie
  // omija swojego limitu zmieniając sieć.
  if (
    !(await checkRateLimit('apply', {
      max: 20,
      windowSeconds: 3600,
      identifier: me.id,
      perIp: false,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  // Dodatkowa, znacznie szersza ochrona sieciowa przed automatyzacją wielu kont z jednego
  // adresu — próg nie blokuje populacji współdzielącej IP po zwykłym użyciu limitu jednej
  // osoby (#852).
  if (!(await checkRateLimit('apply-ip', { max: 200, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
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
    const code = reportUnmappedDbError(error, 'applications.applyToJob', mapPgError(message));
    const questionId = SCREENING_REQUIRED_RE.exec(message)?.[1];
    return questionId ? { ok: false, error: code, questionId } : { ok: false, error: code };
  }
}

/** Pracodawca zmienia status aplikacji (allow-lista przejść egzekwowana w RPC). */
export async function transitionApplication(
  applicationId: string,
  target: string,
): Promise<TransitionResult> {
  if (!isRecruitmentEnabled('applications')) return { ok: false, error: 'RECRUITMENT_DISABLED' };
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    if (
      !(await checkRateLimit('application-status', {
        ...TRANSITION_RATE_LIMITS.perUser,
        identifier: me.id,
        perIp: false,
      })) ||
      !(await checkRateLimit('application-status-item', {
        ...TRANSITION_RATE_LIMITS.perApplication,
        identifier: `${me.id}:${applicationId}`,
        perIp: false,
      }))
    ) {
      return { ok: false, error: 'RATE_LIMITED' };
    }
    await withPortalTransaction(me, (tx) => rpc(tx, 'transition_application', {
      p_application_id: applicationId,
      p_target: target,
    }));
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) {
      return { ok: false, error: reportUnmappedDbError(error, 'applications.transitionApplication', mapPgError(databaseErrorMessage(error))) };
    }
    captureError(error, { area: 'applications.transitionApplication' });
    return { ok: false, error: 'INTERNAL' };
  }
}

const BULK_OUTCOMES: ReadonlySet<string> = new Set<string>(BULK_TRANSITION_OUTCOMES);

export type BulkTransitionResult =
  | { ok: true; results: { applicationId: string; outcome: BulkTransitionOutcome }[] }
  | { ok: false; error: ErrorCode };

const bulkTransitionSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(BULK_TRANSITION_MAX)
    .refine((ids) => new Set(ids).size === ids.length),
  target: z.enum(MENU_TARGET_STATUSES),
  expectedCompanyId: z.string().uuid(),
});

/**
 * Akcja zbiorcza: zmiana statusu wielu zgłoszeń AKTYWNEJ firmy jednym działaniem. Firma
 * przychodzi z widoku (`expectedCompanyId`) i musi być bieżącą aktywną firmą (inaczej
 * `ACTIVE_COMPANY_CHANGED`, nic nie zapisujemy — jak formularze po przełączeniu firmy).
 * Każde zgłoszenie przechodzi przez `transition_application` (ta sama macierz przejść) w
 * osobnym podbloku `bulk_transition_applications`; wynik per wiersz trafia do raportu.
 */
export async function bulkTransitionApplications(
  applicationIds: string[],
  target: string,
  expectedCompanyId: string,
): Promise<BulkTransitionResult> {
  if (!isRecruitmentEnabled('applications')) return { ok: false, error: 'RECRUITMENT_DISABLED' };
  const parsed = bulkTransitionSchema.safeParse({ applicationIds, target, expectedCompanyId });
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    if (
      !(await checkRateLimit('application-status-bulk', {
        ...TRANSITION_RATE_LIMITS.bulkPerUser,
        identifier: me.id,
        perIp: false,
      }))
    ) {
      return { ok: false, error: 'RATE_LIMITED' };
    }
    const outcome = await withPortalTransaction(
      me,
      async (tx): Promise<{ ok: false; error: ErrorCode } | { ok: true; rows: unknown[] }> => {
        const expected = await getExpectedActiveCompany(tx, me.id, parsed.data.expectedCompanyId);
        if (!expected.ok) return { ok: false, error: expected.error };
        const rows = await rpcRows(tx, 'bulk_transition_applications', {
          p_company_id: expected.context.activeId,
          p_application_ids: parsed.data.applicationIds,
          p_target: parsed.data.target,
        });
        return { ok: true, rows };
      },
    );
    if (!outcome.ok) return { ok: false, error: outcome.error };
    const results = outcome.rows.map((row) => {
      const record = row as Record<string, unknown>;
      const raw = typeof record['outcome'] === 'string' ? record['outcome'] : 'error';
      return {
        applicationId: String(record['application_id'] ?? ''),
        outcome: (BULK_OUTCOMES.has(raw) ? raw : 'error') as BulkTransitionOutcome,
      };
    });
    return { ok: true, results };
  } catch (error) {
    if (isDatabaseError(error)) {
      return {
        ok: false,
        error: reportUnmappedDbError(error, 'applications.bulkTransitionApplications', mapPgError(databaseErrorMessage(error))),
      };
    }
    captureError(error, { area: 'applications.bulkTransitionApplications' });
    return { ok: false, error: 'INTERNAL' };
  }
}
