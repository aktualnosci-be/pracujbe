import 'server-only';

import { after } from 'next/server';

import { withServiceRole } from '@/lib/db/portal';
import { queryOne, rpc } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { checkBelgianVatInVies, type ViesClientOptions } from '@/lib/vies/client';
import { companyVatSource } from '@/lib/vies/state';

/**
 * Automatyczne sprawdzenie VAT w VIES po założeniu firmy (decyzja właściciela 26.09.2026).
 *
 * Woła je wyłącznie SERWER po udanym `create_first_company` / `create_additional_company` /
 * `create_company_with_owner` — klient nie ma na nie wpływu. Kolejność: bieżący numer firmy
 * (service_role) → istniejący adapter VIES (pre-check BE, timeout, ponowienia) → zapis TYLKO
 * wyniku rozstrzygającego przez `record_company_vies_check_auto` (0197: service_role, bez
 * nadpisywania wyniku admina, audyt). Firma bez numeru albo z numerem spoza BE — brak
 * zapytania. Awaria VIES / bazy niczego nie blokuje i nie zmienia statusu firmy (status
 * zmienia tylko admin); wynik widzi admin w `/admin/firmy/[id]`, kandydaci — nie.
 * Logujemy wyłącznie obszar błędu — bez numeru, nazwy i odpowiedzi VIES.
 */

export type AutoViesOutcome = 'saved' | 'not_saved' | 'skipped' | 'unavailable' | 'error';

export async function runCompanyViesAutoCheck(
  companyId: string,
  options: ViesClientOptions = {},
): Promise<AutoViesOutcome> {
  try {
    const row = await withServiceRole((tx) =>
      queryOne<{ vat_number: string | null; registration_number: string | null }>(
        tx,
        'company.vies-auto-source',
        `SELECT vat_number, registration_number
           FROM public.companies
          WHERE id = $1 AND deleted_at IS NULL`,
        [companyId],
      ),
    );
    const source = row ? companyVatSource(row.vat_number, row.registration_number) : null;
    if (!source) return 'skipped';

    const result = await checkBelgianVatInVies(source, options);
    if (result.status === 'format_invalid') return 'skipped';
    if (result.status !== 'valid' && result.status !== 'invalid') return 'unavailable';

    const saved = await withServiceRole((tx) =>
      rpc<boolean>(tx, 'record_company_vies_check_auto', {
        p_company_id: companyId,
        p_vat_number: result.vatNumber,
        p_result: result.status,
        p_vies_name: result.status === 'valid' ? result.name : null,
        p_request_date: result.requestDate,
      }),
    );
    return saved === true ? 'saved' : 'not_saved';
  } catch (e) {
    captureError(e, { area: 'company.viesAutoCheck' });
    return 'error';
  }
}

/**
 * Planuje sprawdzenie PO wysłaniu odpowiedzi (`after`), żeby zapytanie do VIES (do kilku
 * ponowień) nie opóźniało zakładania firmy. Poza kontekstem żądania — w tle bez czekania.
 * Nigdy nie rzuca.
 */
export function scheduleCompanyViesAutoCheck(companyId: string): void {
  const task = async (): Promise<void> => {
    await runCompanyViesAutoCheck(companyId);
  };
  try {
    after(task);
  } catch {
    void task();
  }
}
