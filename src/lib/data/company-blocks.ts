/**
 * Blokady firm przez kandydata (#97) — odczyt POD SESJĄ kandydata (RPC SECURITY DEFINER
 * zwracające wyłącznie własne blokady; nigdy service-role).
 *
 * Egzekwowanie blokady żyje w bazie (migracja 0078): profil/PII, wyszukiwanie, dopasowania,
 * propozycje i wiadomości zablokowanej firmy. Tu jest tylko odczyt dla ekranu ustawień
 * i szczegółu oferty. Błąd odczytu = jawny `error` (bez udawania pustej listy); technikalia
 * wyłącznie do Sentry (Invariant #8).
 *
 * Tryb demo (bez env): jedna przykładowa blokada firmy demonstracyjnej (Invariant #12 —
 * `demo: true`), żeby ekran i przepływ odblokowania działały bez backendu.
 */

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
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
  if (!isSupabaseConfigured()) return { status: 'ready', blocks: demoBlocks(), demo: true };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('get_my_company_blocks');
    if (error) throw error;
    const rows: unknown[] = Array.isArray(data) ? data : [];
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
  if (!isSupabaseConfigured()) return { status: 'none' };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'none' };

    const { data, error } = await supabase.rpc('get_job_company_block', { p_job_id: jobId });
    if (error) throw error;
    const row = Array.isArray(data) ? asRecord(data[0]) : {};
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
