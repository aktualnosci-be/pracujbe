import 'server-only';

import { isLocale, routing } from '@/i18n/routing';
import { withUserTransaction, type TransactionPool } from './transaction';

export type PublicCompanyRow = Record<string, unknown>;

export interface PublicCompanyJobsResult {
  rows: PublicCompanyRow[];
}

function locale(value: string): string {
  return isLocale(value) ? value : routing.defaultLocale;
}

/**
 * Profil firmy (#591): wyłącznie zweryfikowana, nieusunięta firma po stabilnym slugu
 * (`companies.slug`, niezmienianym przy zmianie nazwy). Zły slug albo firma poza statusem
 * `verified` = brak wiersza — strona renderuje 404 (Invariant #8, żadnych technikaliów).
 */
export async function getPublicCompany(
  pool: TransactionPool,
  slug: string,
): Promise<PublicCompanyRow | null> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT to_jsonb(company) AS company
      FROM public.get_public_company(p_slug => $1::text) AS company`,
      [slug],
    )) as { rows: { company: PublicCompanyRow }[] };
    return result.rows[0]?.company ?? null;
  });
}

/** Aktywne, niewygasłe oferty firmy zweryfikowanej po slugu — sama kolumny co lista ofert. */
export async function getPublicCompanyJobs(
  pool: TransactionPool,
  slug: string,
  requestedLocale: string,
  limit: number,
  offset: number,
): Promise<PublicCompanyJobsResult> {
  return withUserTransaction(pool, null, async (transaction) => {
    const result = (await transaction.query(
      `SELECT to_jsonb(job) AS job
      FROM public.get_public_company_jobs(
        p_slug => $1::text, p_locale => $2::text, p_limit => $3::integer, p_offset => $4::integer
      ) AS job`,
      [slug, locale(requestedLocale), limit, offset],
    )) as { rows: { job: PublicCompanyRow }[] };
    return { rows: result.rows.map((row) => row.job) };
  });
}
