/**
 * Blokady firm przez kandydata (#97) — odczyt POD SESJĄ kandydata (`withPortalTransaction`,
 * RPC SECURITY DEFINER zwracające wyłącznie własne blokady `auth.uid()`; nigdy service-role).
 *
 * Egzekwowanie blokady żyje w bazie (migracja 0078): profil/PII, wyszukiwanie, dopasowania,
 * propozycje i wiadomości zablokowanej firmy. Tu jest tylko odczyt dla ekranu ustawień
 * i szczegółu oferty. Błąd odczytu = jawny `error` (bez udawania pustej listy); technikalia
 * wyłącznie do kanału błędów (Invariant #8).
 *
 * Tryb demo (bez env): jedna przykładowa blokada firmy demonstracyjnej (Invariant #12 —
 * `demo: true`), żeby ekran i przepływ odblokowania działały bez backendu.
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { demoCompanies } from '@/lib/data/demo';

export interface CompanyBlock {
  companyId: string;
  companyName: string;
  blockedAt: string;
}

export type CompanyBlocksLoad =
  | { status: 'ready'; blocks: CompanyBlock[]; demo: boolean }
  | { status: 'error' };

export type JobCompanyBlockLoad =
  | { status: 'none' }
  | { status: 'ready'; companyId: string; companyName: string; blocked: boolean }
  | { status: 'error' };

const DEMO_BLOCKED_AT = '2026-09-01T09:00:00.000Z';

function demoBlocks(): CompanyBlock[] {
  const company = demoCompanies[demoCompanies.length - 1];
  return company ? [{ companyId: company.id, companyName: company.name, blockedAt: DEMO_BLOCKED_AT }] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Lista własnych blokad (ustawienia kandydata). */
export async function loadMyCompanyBlocks(): Promise<CompanyBlocksLoad> {
  if (!isPortalDataConfigured()) return { status: 'ready', blocks: demoBlocks(), demo: true };

  try {
    const me = await getPortalIdentity();
    // Bez sesji nie ma własnych blokad (RPC nie jest dostępne dla gościa).
    if (!me) return { status: 'ready', blocks: [], demo: false };
    const rows = await withPortalTransaction(me, (tx) => rpcRows(tx, 'get_my_company_blocks'));
    const blocks = rows
      .map((row) => {
        const r = asRecord(row);
        return {
          companyId: asStr(r['company_id']),
          companyName: asStr(r['company_name']),
          blockedAt: asStr(r['blocked_at']),
        };
      })
      .filter((block) => block.companyId.length > 0);
    return { status: 'ready', blocks, demo: false };
  } catch (error) {
    captureError(error, { area: 'company-blocks.loadMyCompanyBlocks' });
    return { status: 'error' };
  }
}

/**
 * Stan blokady firmy danej oferty dla zalogowanego kandydata. Gość, pracodawca, oferta
 * niepubliczna i tryb demo → `none` (kontrolka się nie renderuje).
 */
export async function getJobCompanyBlock(jobId: string): Promise<JobCompanyBlockLoad> {
  if (!isPortalDataConfigured()) return { status: 'none' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'none' };

    const rows = await withPortalTransaction(me, (tx) =>
      rpcRows(tx, 'get_job_company_block', { p_job_id: jobId }),
    );
    const row = asRecord(rows[0]);
    const companyId = asStr(row['company_id']);
    if (!companyId) return { status: 'none' };
    return {
      status: 'ready',
      companyId,
      companyName: asStr(row['company_name']),
      blocked: row['blocked'] === true,
    };
  } catch (error) {
    captureError(error, { area: 'company-blocks.getJobCompanyBlock' });
    return { status: 'error' };
  }
}
