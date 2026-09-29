'use server';

import { revalidatePath } from 'next/cache';

import { isLocale } from '@/i18n/routing';
import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Język opisu firmy (#708, migracja 0975 — numer tymczasowy). Owner/admin firmy wskazuje, w jakim
 * języku napisano opis; publiczny profil oznacza nim treść (`lang`) i informuje odwiedzającego,
 * gdy opis jest w innym języku niż strona. `companyId` przychodzi z formularza wyrenderowanego
 * dla tej firmy (#801) — członkostwo sprawdzane jawnie. Zmiana treści opisu zeruje język w bazie
 * (trigger), więc zadeklarowany język nigdy nie zostaje przypięty do nowego tekstu.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompanyDescriptionLocaleResult =
  | { ok: true; demo?: true; outcome: 'saved' | 'unchanged' }
  | { ok: false; error: ErrorCode; reason?: 'descriptionEmpty' };

function mapPgError(message: string | undefined): { error: ErrorCode; reason?: 'descriptionEmpty' } {
  const m = message ?? '';
  if (m.includes('DESCRIPTION_EMPTY')) return { error: 'VALIDATION_FAILED', reason: 'descriptionEmpty' };
  if (m.includes('VALIDATION_FAILED') || m.includes('LOCALE_INVALID')) return { error: 'VALIDATION_FAILED' };
  if (m.includes('NOT_FOUND')) return { error: 'NOT_FOUND' };
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED')) return { error: 'PERMISSION_DENIED' };
  return { error: 'INTERNAL' };
}

export async function updateCompanyDescriptionLocale(
  companyId: string,
  locale: string | null,
): Promise<CompanyDescriptionLocaleResult> {
  const value = locale === null || locale === '' ? null : locale;
  if (value !== null && !isLocale(value)) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: true, demo: true, outcome: 'unchanged' };
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) return { ok: false, error: 'NOT_FOUND' };
  if (!(await checkRateLimit('company-update', { max: 60, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    type Outcome = { error: ErrorCode } | { error: null; before: unknown; after: unknown };
    const outcome = await withPortalTransaction(me, async (tx): Promise<Outcome> => {
      const row = await queryOne<Record<string, unknown>>(tx, 'company.description-locale-membership',
        `SELECT m.role, c.description_locale
           FROM public.company_members m
           JOIN public.companies c ON c.id = m.company_id
          WHERE m.profile_id = $1 AND m.company_id = $2 AND m.is_active = true
          LIMIT 1`,
        [me.id, companyId]);
      if (!row) return { error: 'NOT_FOUND' };
      if (row['role'] !== 'owner' && row['role'] !== 'admin') return { error: 'PERMISSION_DENIED' };
      const after = await rpc(tx, 'set_company_description_locale', {
        p_company_id: companyId,
        p_locale: value,
      });
      return { error: null, before: row['description_locale'] ?? null, after: after ?? null };
    });
    if (outcome.error !== null) return { ok: false, error: outcome.error };

    const changed = outcome.before !== outcome.after;
    revalidatePath('/employer', 'layout');
    if (changed) {
      // Profil publiczny (ISR, #298): oznaczenie języka opisu widoczne od razu.
      revalidatePath('/[locale]/pracodawcy/[slug]', 'page');
      revalidatePath('/[locale]/pracodawcy/[slug]/strona/[page]', 'page');
    }
    return { ok: true, outcome: changed ? 'saved' : 'unchanged' };
  } catch (e) {
    if (isDatabaseError(e)) {
      const mapped = mapPgError(databaseErrorMessage(e));
      const error = reportUnmappedDbError(e, 'company.updateCompanyDescriptionLocale', mapped.error);
      return mapped.reason ? { ok: false, error, reason: mapped.reason } : { ok: false, error };
    }
    captureError(e, { area: 'company.updateCompanyDescriptionLocale' });
    return { ok: false, error: 'INTERNAL' };
  }
}
