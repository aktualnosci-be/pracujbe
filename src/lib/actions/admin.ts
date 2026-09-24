'use server';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Server Actions panelu administratora — Pracuj.be (Etap 7g).
 *
 *   - `setCompanyStatus` — zmienia status weryfikacji firmy przez RPC `admin_set_company_status`.
 *   - `resolveReport`    — rozstrzyga zgłoszenie przez RPC `admin_resolve_report`.
 *
 * Oba RPC (0081, #420) egzekwują macierz przejść (`INVALID_TRANSITION`) i porównują status
 * widziany przez admina z bieżącym (`p_expected_status`, `FOR UPDATE` → `STALE_STATE`, gdy
 * inny admin zmienił go w międzyczasie).
 *
 * Zapis idzie pod SESJĄ użytkownika (`createServerClient`), bo RPC są `SECURITY DEFINER`
 * i wewnętrznie sprawdzają `is_admin()` na `auth.uid()` — service-role NIE nadaje się tu
 * (nie ma tożsamości admina). Walidacja wartości statusów po stronie akcji (allow-lista),
 * błędy Postgresa mapowane na stabilny `ErrorCode` (Invariant #8). Bez env → tryb DEMO
 * (`{ ok: true, demo: true }`), by build/UX działały bez backendu.
 */

export type AdminActionResult = { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };

const COMPANY_STATUSES = ['unverified', 'pending', 'verified', 'rejected', 'suspended'] as const;
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('STALE_STATE')) return 'STALE_STATE';
  if (m.includes('INVALID_TRANSITION')) return 'INVALID_TRANSITION';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED') || m.includes('invalid input value')) return 'VALIDATION_FAILED';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('JWT') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/** Zmienia status weryfikacji firmy (tylko admin — egzekwowane przez RPC). */
export async function setCompanyStatus(
  companyId: string,
  status: string,
  expectedStatus: string,
): Promise<AdminActionResult> {
  if (
    !companyId ||
    !(COMPANY_STATUSES as readonly string[]).includes(status) ||
    !(COMPANY_STATUSES as readonly string[]).includes(expectedStatus)
  ) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_set_company_status', {
      p_company_id: companyId,
      p_status: status,
      p_expected_status: expectedStatus,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.setCompanyStatus' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Rozstrzyga zgłoszenie (tylko admin — egzekwowane przez RPC). */
export async function resolveReport(
  reportId: string,
  status: string,
  expectedStatus: string,
): Promise<AdminActionResult> {
  if (
    !reportId ||
    !(REPORT_STATUSES as readonly string[]).includes(status) ||
    !(REPORT_STATUSES as readonly string[]).includes(expectedStatus)
  ) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { error } = await supabase.rpc('admin_resolve_report', {
      p_report_id: reportId,
      p_status: status,
      p_expected_status: expectedStatus,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'admin.resolveReport' });
    return { ok: false, error: 'INTERNAL' };
  }
}
