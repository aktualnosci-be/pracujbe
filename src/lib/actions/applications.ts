'use server';

import { randomUUID } from 'node:crypto';

import { createServerClient } from '@/lib/supabase/server';
import type { ErrorCode } from '@/lib/errors';
import { applicationSchema, type ApplicationInput } from '@/lib/validation/application';

/**
 * Server Actions procesu aplikowania — cienka warstwa nad bezpiecznymi RPC (0012).
 * Cała logika domenowa (idempotencja, powiązania, historia, kolejka e-mail) jest w DB;
 * tu: walidacja Zod + wywołanie RPC + mapowanie błędu na kod użytkowy (bez technikaliów).
 */

export type ApplyResult = { ok: true; id: string } | { ok: false; error: ErrorCode };
export type TransitionResult = { ok: true } | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
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

/** Kandydat aplikuje na ofertę (idempotentnie). */
export async function applyToJob(input: ApplicationInput): Promise<ApplyResult> {
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
  });

  if (error) return { ok: false, error: mapPgError(error.message) };
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
