import 'server-only';

import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

/**
 * Nazwy firm, w których konto ma WYŁĄCZNIE odebrany dostęp (#1210, decyzja właściciela
 * 29.09.2026). Pod RLS osoba bez aktywnego członkostwa nie odczyta firmy niezweryfikowanej
 * (`companies_select_member` wymaga aktywnego członkostwa), więc nazwę czyta pula service_role —
 * wyłącznie kolumnę `name`, wyłącznie dla identyfikatora z ZWERYFIKOWANEJ sesji (nigdy z adresu
 * czy formularza), wyłącznie nieusuniętych firm z nieaktywnym członkostwem tej osoby. Bez
 * szczegółów (kto, kiedy, dlaczego). Awaria albo brak puli = pusta lista (komunikat ogólny).
 */
export const MAX_REVOKED_COMPANY_NAMES = 5;

export async function getRevokedCompanyNames(profileId: string): Promise<string[]> {
  if (!isServiceDatabaseConfigured()) return [];
  try {
    const rows = await withServiceRole((tx) =>
      queryRows<{ name: string }>(
        tx,
        'employer.revoked-company-names',
        `SELECT c.name
           FROM public.company_members cm
           JOIN public.companies c ON c.id = cm.company_id
          WHERE cm.profile_id = $1
            AND cm.is_active = false
            AND c.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.company_members a
               WHERE a.profile_id = $1 AND a.is_active = true
            )
          ORDER BY cm.updated_at DESC, c.id
          LIMIT ${MAX_REVOKED_COMPANY_NAMES}`,
        [profileId],
      ),
    );
    return rows
      .map((row) => (typeof row.name === 'string' ? row.name.trim() : ''))
      .filter((name, index, all) => name !== '' && all.indexOf(name) === index);
  } catch (error) {
    captureError(error, { area: 'employer.revokedCompanyNames' });
    return [];
  }
}
