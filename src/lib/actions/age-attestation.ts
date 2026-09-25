'use server';

import { z } from 'zod/v3';

import { minAgeSchema } from '@/lib/age-policy';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';

/**
 * Server Action deklaracji progu wieku kandydata (#492) — dla konta sprzed polityki albo po
 * podniesieniu progu. Zapis wyłącznie przez RPC `attest_candidate_age` (0126, SECURITY
 * DEFINER): konto z sesji, deklaracja co najmniej na BIEŻĄCY próg (inaczej odmowa), bez daty
 * urodzenia. Zwracany stan pochodzi z bazy. Błędy → kod użytkowy (Invariant #8).
 */

export type AttestAgeResult = { ok: true; meetsPolicy: boolean; demo?: boolean } | { ok: false; error: ErrorCode };

const inputSchema = z.object({ confirmed: z.literal(true), minAge: minAgeSchema });

export async function attestCandidateAgeAction(input: unknown): Promise<AttestAgeResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };

  if (!isPortalDataConfigured()) return { ok: true, meetsPolicy: true, demo: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'attest_candidate_age', { p_min_age: parsed.data.minAge }),
    );
    return { ok: true, meetsPolicy: data === true };
  } catch (error) {
    if (isDatabaseError(error)) {
      const message = databaseErrorMessage(error);
      if (message.includes('AGE_ATTESTATION_REQUIRED')) return { ok: false, error: 'AGE_ATTESTATION_REQUIRED' };
      if (message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED')) {
        return { ok: false, error: 'PERMISSION_DENIED' };
      }
      if (message.includes('VALIDATION_FAILED')) return { ok: false, error: 'VALIDATION_FAILED' };
    }
    captureError(error, { area: 'age-attestation.attest' });
    return { ok: false, error: 'INTERNAL' };
  }
}
