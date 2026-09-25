import 'server-only';

import { cookies } from 'next/headers';
import { queryRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';

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

/**
 * Zwraca aktywną firmę użytkownika (z cookie, zwalidowaną) + listę jego firm.
 * `activeId === null`, gdy użytkownik nie ma żadnego aktywnego członkostwa.
 */
export async function getActiveCompany(
  tx: TransactionQuery,
  userId: string,
): Promise<ActiveCompanyContext> {
  // company_members_select (RLS): własne wiersze; companies pod własną polityką członka.
  const rows = await queryRows<Record<string, unknown>>(tx, 'company-context.memberships',
    `SELECT m.company_id, m.role, c.name, c.status
       FROM public.company_members m
       LEFT JOIN public.companies c ON c.id = m.company_id
      WHERE m.profile_id = $1 AND m.is_active = true
      ORDER BY m.created_at ASC`, [userId]);

  const companies: CompanyOption[] = [];
  for (const r of rows) {
    const id = asStr(r['company_id']);
    if (!id) throw new Error('Company membership row is missing company id');
    companies.push({
      id,
      name: asStr(r['name']),
      role: asStr(r['role'], 'member'),
      status: asStr(r['status'], 'unverified'),
    });
  }

  const first = companies[0];
  if (!first) {
    return {
      activeId: null,
      activeStatus: 'unverified',
      activeName: '',
      activeRole: 'member',
      companies: [],
    };
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
  tx: TransactionQuery,
  userId: string,
): Promise<string | null> {
  return (await getActiveCompany(tx, userId)).activeId;
}
