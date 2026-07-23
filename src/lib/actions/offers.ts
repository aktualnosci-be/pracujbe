'use server';

import { randomUUID } from 'node:crypto';

import { createServerClient } from '@/lib/supabase/server';
import type { ErrorCode } from '@/lib/errors';
import { offerSchema, type OfferInput } from '@/lib/validation/offer';

/**
 * Server Actions propozycji pracy — cienka warstwa nad RPC send_offer/respond_to_offer (0012).
 * Idempotencja, walidacja verified/active/członkostwa oraz niezależny outbox e-mail są w DB.
 */

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

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('send_offer', {
    p_job_id: v.jobId,
    p_candidate_id: v.candidateId,
    p_idempotency_key: v.idempotencyKey ?? randomUUID(),
    p_message: v.message,
    p_expires_at: null,
  });

  if (error) return { ok: false, error: mapPgError(error.message) };
  return { ok: true, id: String(data) };
}

/** Kandydat akceptuje lub odrzuca propozycję. */
export async function respondToOffer(offerId: string, accept: boolean): Promise<RespondResult> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc('respond_to_offer', {
    p_offer_id: offerId,
    p_accept: accept,
  });
  if (error) return { ok: false, error: mapPgError(error.message) };
  return { ok: true };
}
