import 'server-only';

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Aktywny kontekst firmy (FUN-07) — JEDNO źródło prawdy dla paneli/akcji pracodawcy.
 *
 * Wcześniej każda ścieżka brała „pierwsze aktywne członkostwo", a przełącznik firmy był atrapą —
 * użytkownik należący do wielu firm mógł nieświadomie operować na złej firmie. Teraz wybór firmy
 * trzymamy w cookie `pb_active_company`, ale NIGDY jej nie ufamy: przy każdym odczycie walidujemy
 * wartość względem AKTYWNYCH członkostw użytkownika (RLS: własne wiersze company_members). Zła/obca
 * wartość → fallback do pierwszej firmy. Dzięki temu cookie to jedynie podpowiedź, nie granica zaufania.
 */

export const ACTIVE_COMPANY_COOKIE = 'pb_active_company';

export interface CompanyOption {
  id: string;
  name: string;
  role: string;
  status: string;
}

export interface ActiveCompanyContext {
  activeId: string | null;
  activeStatus: string;
  activeName: string;
  activeRole: string;
  companies: CompanyOption[];
}

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asRec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
/** Embed PostgREST bywa obiektem (to-one) lub tablicą — normalizujemy do pierwszego rekordu. */
function embed(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? asRec(value[0]) : asRec(value);
}

/**
 * Zwraca aktywną firmę użytkownika (z cookie, zwalidowaną) + listę jego firm.
 * `activeId === null`, gdy użytkownik nie ma żadnego aktywnego członkostwa.
 */
export async function getActiveCompany(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveCompanyContext> {
  const { data, error } = await supabase
    .from('company_members')
    .select('company_id, role, companies(id, name, status)')
    .eq('profile_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const companies: CompanyOption[] = [];
  for (const row of asArr(data)) {
    const r = asRec(row);
    const c = embed(r['companies']);
    const id = asStr(r['company_id']) || asStr(c['id']);
    if (!id) continue;
    companies.push({
      id,
      name: asStr(c['name']),
      role: asStr(r['role'], 'member'),
      status: asStr(c['status'], 'unverified'),
    });
  }

  const first = companies[0];
  if (!first) {
    return { activeId: null, activeStatus: 'unverified', activeName: '', activeRole: 'member', companies: [] };
  }

  const cookieVal = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value ?? '';
  const chosen = companies.find((x) => x.id === cookieVal) ?? first;
  return {
    activeId: chosen.id,
    activeStatus: chosen.status,
    activeName: chosen.name,
    activeRole: chosen.role,
    companies,
  };
}

/**
 * Sam identyfikator aktywnej firmy (dla ścieżek, które potrzebują tylko id) — cookie-aware.
 * Zwraca `null`, gdy brak aktywnego członkostwa.
 */
export async function getActiveCompanyId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  return (await getActiveCompany(supabase, userId)).activeId;
}
