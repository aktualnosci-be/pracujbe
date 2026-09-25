'use server';

import { z } from 'zod/v3';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
import { getJobCompanyBlock, type JobCompanyBlockLoad } from '@/lib/data/company-blocks';

/**
 * Server Actions blokady firm przez kandydata (#97).
 *
 * Zapis wyłącznie przez RPC `set_company_block` (SECURITY DEFINER, 0078; pod sesją przez
 * `withPortalTransaction`, #25): rola kandydata,
 * idempotentnie, tylko własne blokady. Wejście walidowane Zod (UUID + bool) przed zapytaniem.
 * Tryb demo: walidacja bez zapisu (`demo: true`). Błędy → kod użytkowy (Invariant #8).
 */

const blockSchema = z.object({
  companyId: z.string().uuid(),
  blocked: z.boolean(),
});

/** Firmy demonstracyjne mają krótkie identyfikatory (np. `c11`), nie UUID. */
const demoBlockSchema = z.object({
  companyId: z.string().regex(/^c\d{1,3}$/),
  blocked: z.boolean(),
});

export type SetCompanyBlockResult =
  | { ok: true; blocked: boolean; demo?: boolean }
  | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('JWT')) {
    return 'PERMISSION_DENIED';
  }
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  return 'INTERNAL';
}

export async function setCompanyBlockAction(companyId: unknown, blocked: unknown): Promise<SetCompanyBlockResult> {
  if (!isPortalDataConfigured()) {
    const demo = demoBlockSchema.safeParse({ companyId, blocked });
    if (!demo.success) return { ok: false, error: 'VALIDATION_FAILED' };
    return { ok: true, blocked: demo.data.blocked, demo: true };
  }

  const parsed = blockSchema.safeParse({ companyId, blocked });
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'set_company_block', {
        p_company_id: parsed.data.companyId,
        p_blocked: parsed.data.blocked,
      }),
    );
    return { ok: true, blocked: data === true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'company-blocks.setCompanyBlockAction' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Stan blokady firmy oferty (wyspa kliencka na szczególe oferty, po montażu). */
export async function getJobCompanyBlockAction(jobId: unknown): Promise<JobCompanyBlockLoad> {
  const parsed = z.string().uuid().safeParse(jobId);
  if (!parsed.success) return { status: 'none' };
  return getJobCompanyBlock(parsed.data);
}
