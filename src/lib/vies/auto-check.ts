import 'server-only';

import { after } from 'next/server';

import { withServiceRole } from '@/lib/db/portal';
import { rpc, rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { checkBelgianVatInVies, type ViesClientOptions } from '@/lib/vies/client';
import { VIES_AUTO_MAX_ATTEMPTS } from '@/lib/vies/state';

/**
 * Automatyczne sprawdzenie VAT w VIES (decyzja właściciela 26.09.2026; kolejka #706/#879).
 *
 * Zadania tworzy BAZA (0192): trigger na `companies` kolejkuje firmę przy każdym zapisie
 * nowego prawidłowego numeru VAT/KBO bez wyniku dla tego numeru — założenie firmy, późniejsze
 * dopisanie numeru w `/employer/firma` (#879) albo zmiana numeru. Klient nie ma na to wpływu.
 *
 * Worker (ten plik) pobiera zadania `claim_company_vies_auto_checks` (SKIP LOCKED, dzierżawa,
 * najwyżej `VIES_AUTO_MAX_ATTEMPTS` prób), woła istniejący adapter VIES (pre-check BE, timeout,
 * ponowienia) i:
 *   - wynik rozstrzygający → `record_company_vies_check_auto` (zapis zdejmuje zadanie);
 *     brak zapisu (np. wynik admina dla tego numeru, numer zmieniony w trakcie) → `done`;
 *   - niedostępność / limit / błąd → `finish_company_vies_auto_check` z terminem ponowienia
 *     (backoff w bazie) — chwilowa awaria VIES nie gubi sprawdzenia (#706).
 * Uruchamiany: `/api/maintenance` (co godzinę) oraz jednorazowo po zapisie firmy (`after`),
 * żeby wynik zwykle pojawiał się od razu. Status firmy zmienia wyłącznie admin.
 * Logujemy wyłącznie obszar błędu — bez numeru, nazwy i odpowiedzi VIES.
 */

export { VIES_AUTO_MAX_ATTEMPTS };
/** Zadań na jeden przebieg maintenance — zapytania do VIES idą po kolei (limit usługi). */
export const VIES_AUTO_BATCH_LIMIT = 10;

export type AutoViesOutcome = 'saved' | 'not_saved' | 'skipped' | 'unavailable' | 'error';

type FinishOutcome = 'done' | 'unavailable' | 'rate_limited' | 'error';

interface ClaimedJob {
  companyId: string;
  vatNumber: string;
}

async function claim(limit: number, companyId: string | null): Promise<ClaimedJob[]> {
  const rows = await withServiceRole((tx) =>
    rpcRows<{ company_id: string; vat_number: string }>(tx, 'claim_company_vies_auto_checks', {
      p_limit: limit,
      p_company_id: companyId,
    }),
  );
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => typeof r?.company_id === 'string' && typeof r?.vat_number === 'string')
    .map((r) => ({ companyId: r.company_id, vatNumber: r.vat_number }));
}

async function finish(job: ClaimedJob, outcome: FinishOutcome): Promise<void> {
  await withServiceRole((tx) =>
    rpc(tx, 'finish_company_vies_auto_check', {
      p_company_id: job.companyId,
      p_vat_number: job.vatNumber,
      p_outcome: outcome,
    }),
  );
}

async function checkClaimed(job: ClaimedJob, options: ViesClientOptions): Promise<AutoViesOutcome> {
  try {
    const result = await checkBelgianVatInVies(job.vatNumber, options);
    if (result.status === 'format_invalid') {
      await finish(job, 'done');
      return 'skipped';
    }
    if (result.status === 'rate_limited' || result.status === 'unavailable') {
      await finish(job, result.status);
      return 'unavailable';
    }
    const saved = await withServiceRole((tx) =>
      rpc<boolean>(tx, 'record_company_vies_check_auto', {
        p_company_id: job.companyId,
        p_vat_number: result.vatNumber,
        p_result: result.status,
        p_vies_name: result.status === 'valid' ? result.name : null,
        p_request_date: result.requestDate,
      }),
    );
    if (saved === true) return 'saved';
    await finish(job, 'done');
    return 'not_saved';
  } catch (e) {
    captureError(e, { area: 'company.viesAutoCheck' });
    try {
      // Dzierżawa i tak wygaśnie; zwolnienie od razu ustawia termin z backoffem.
      await finish(job, 'error');
    } catch (finishError) {
      captureError(finishError, { area: 'company.viesAutoCheck.finish' });
    }
    return 'error';
  }
}

export interface ViesAutoQueueRun {
  claimed: number;
  saved: number;
  notSaved: number;
  skipped: number;
  deferred: number;
  errors: number;
}

/**
 * Przebieg kolejki (maintenance). Błąd pobrania zadań rzuca (zadanie maintenance = błąd);
 * błąd pojedynczego sprawdzenia to licznik `errors` i termin ponowienia.
 */
export async function processCompanyViesAutoQueue(
  options: ViesClientOptions & { limit?: number } = {},
): Promise<ViesAutoQueueRun> {
  const { limit = VIES_AUTO_BATCH_LIMIT, ...clientOptions } = options;
  const jobs = await claim(limit, null);
  const run: ViesAutoQueueRun = { claimed: jobs.length, saved: 0, notSaved: 0, skipped: 0, deferred: 0, errors: 0 };
  for (const job of jobs) {
    const outcome = await checkClaimed(job, clientOptions);
    if (outcome === 'saved') run.saved += 1;
    else if (outcome === 'not_saved') run.notSaved += 1;
    else if (outcome === 'skipped') run.skipped += 1;
    else if (outcome === 'unavailable') run.deferred += 1;
    else run.errors += 1;
  }
  return run;
}

/**
 * Jedna próba dla konkretnej firmy — tylko gdy baza ma dla niej wymagalne zadanie (brak
 * zadania: firma bez numeru, numer już sprawdzony, próba w toku = `skipped`, bez VIES).
 * Nigdy nie rzuca.
 */
export async function runCompanyViesAutoCheck(
  companyId: string,
  options: ViesClientOptions = {},
): Promise<AutoViesOutcome> {
  let job: ClaimedJob | undefined;
  try {
    [job] = await claim(1, companyId);
  } catch (e) {
    captureError(e, { area: 'company.viesAutoCheck' });
    return 'error';
  }
  if (!job) return 'skipped';
  return checkClaimed(job, options);
}

/**
 * Planuje próbę PO wysłaniu odpowiedzi (`after`), żeby zapytanie do VIES (do kilku ponowień)
 * nie opóźniało zapisu firmy. Poza kontekstem żądania — w tle bez czekania. Nigdy nie rzuca.
 * Gdy próba się nie uda, zadanie zostaje w kolejce bazy i ponowi je maintenance.
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
