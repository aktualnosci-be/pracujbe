'use server';

import { randomUUID } from 'node:crypto';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { offerSchema, type OfferInput } from '@/lib/validation/offer';

/**
 * Server Actions propozycji pracy — cienka warstwa nad RPC send_offer/respond_to_offer (0012).
 * Idempotencja, walidacja verified/active/członkostwa oraz niezależny outbox e-mail są w DB.
 * Wywołanie w transakcji sesji (`withPortalTransaction`, #25); brak sesji = PERMISSION_DENIED.
 */

/** Błąd wywołania RPC → kod użytkowy; wyjątek spoza bazy → kanał błędów + INTERNAL (Invariant #8). */
function toErrorCode(error: unknown, area: string): ErrorCode {
  if (isDatabaseError(error)) return mapPgError(databaseErrorMessage(error));
  captureError(error, { area });
  return 'INTERNAL';
}

export type SendOfferResult = { ok: true; id: string } | { ok: false; error: ErrorCode };
export type RespondResult = { ok: true } | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('COMPANY_NOT_VERIFIED')) return 'COMPANY_NOT_VERIFIED';
  if (m.includes('JOB_NOT_ACTIVE')) return 'JOB_NOT_ACTIVE';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
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

/** Pracodawca wysyła propozycję (idempotentnie). Błąd e-maila NIE cofa propozycji. */
export async function sendOffer(input: OfferInput): Promise<SendOfferResult> {
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    const data = await withPortalTransaction(me, (tx) => rpc(tx, 'send_offer', {
      p_job_id: v.jobId,
      p_candidate_id: v.candidateId,
      p_idempotency_key: v.idempotencyKey ?? randomUUID(),
      // Brak własnej treści → NULL: zaproszenie renderuje się po stronie odbiorcy w JEGO języku
      // (panel kandydata / e-mail), nie w języku sesji pracodawcy (Invariant #1, #289).
      p_message: v.message ?? null,
      p_expires_at: null,
    }));
    return { ok: true, id: String(data) };
  } catch (error) {
    return { ok: false, error: toErrorCode(error, 'offers.sendOffer') };
  }
}

/** Walidacja UUID na granicy Server Action (P2-19: spójny walidator na wszystkich granicach). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kandydat akceptuje lub odrzuca propozycję. */
export async function respondToOffer(offerId: string, accept: boolean): Promise<RespondResult> {
  // P1-23/P2-19: walidacja UUID PRZED RPC (błędny input → VALIDATION_FAILED, nie „INTERNAL").
  if (typeof offerId !== 'string' || !UUID_RE.test(offerId)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) => rpc(tx, 'respond_to_offer', {
      p_offer_id: offerId,
      p_accept: accept,
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorCode(error, 'offers.respondToOffer') };
  }
}
