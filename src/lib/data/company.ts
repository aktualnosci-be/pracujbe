/**
 * Warstwa danych profilu firmy pracodawcy — Pracuj.be (Etap 4).
 *
 * Strategia spójna z `@/lib/data/employer`: przy skonfigurowanym Supabase dane czytane są
 * pod SESJĄ zalogowanego użytkownika (RLS, NIGDY service-role) przez `createServerClient`.
 * Bez konfiguracji (build/preview bez env) zwracamy dane DEMO — firmę o statusie `verified`,
 * dzięki czemu ekran `/employer/firma` renderuje widok danych firmy (nie formularz zakładania).
 *
 * „Aktywna firma" = pierwsze aktywne członkostwo (`company_members.is_active = true`), tak jak
 * w panelu pracodawcy. Klient Supabase importowany LENIWIE (moduł nie ciągnie `next/headers`
 * do bundla trybu DEMO).
 */

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/** Dane aktywnej firmy zalogowanego pracodawcy (kontrakt dla UI). */
export interface MyCompany {
  id: string;
  name: string;
  slug: string;
  /** Surowy `company_status`: unverified/pending/verified/rejected/suspended. */
  status: string;
  /** Numer VAT/KBO albo null (pole opcjonalne). */
  vatNumber: string | null;
  /** ISO timestamp weryfikacji albo null. */
  verifiedAt: string | null;
  canEdit: boolean;
}

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez env)
 * ------------------------------------------------------------------------- */

const DEMO_COMPANY: MyCompany = {
  id: 'demo-company',
  name: 'AGO Jobs & HR',
  slug: 'ago-jobs-hr',
  status: 'verified',
  vatNumber: 'BE0123456789',
  verifiedAt: '2025-01-15T09:00:00.000Z',
  canEdit: true,
};

/* ---------------------------------------------------------------------------
 * Pomocnicze parsowanie (klient Supabase jest nietypowany → dane `any`)
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Null, gdy pusty/whitespace/nie-string; inaczej przycięta wartość. */
function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/** Embed PostgREST bywa obiektem (to-one) lub tablicą — normalizujemy do pierwszego rekordu. */
function asEmbeddedRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/**
 * Potwierdzony brak członkostwa zwraca `ok` z `company: null`; błędy i niepełne
 * odpowiedzi są osobnym stanem. Bez env → firma DEMO (`verified`).
 */
export type MyCompanyLoad =
  { status: 'ok'; company: MyCompany | null } | { status: 'error' };

export async function getMyCompany(): Promise<MyCompanyLoad> {
  if (!isSupabaseConfigured()) return { status: 'ok', company: DEMO_COMPANY };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) return { status: 'error' };
    const user = authData.user;

    // AKTYWNA firma z kontekstu (cookie-aware, zwalidowana — FUN-07), nie „pierwsze członkostwo".
    const { getActiveCompany } = await import('@/lib/company-context');
    const active = await getActiveCompany(supabase, user.id);
    const activeId = active.activeId;
    if (!activeId) return { status: 'ok', company: null };

    const { data, error } = await supabase
      .from('company_members')
      .select(
        'company_id, companies(id, name, slug, status, vat_number, verified_at)',
      )
      .eq('profile_id', user.id)
      .eq('company_id', activeId)
      .eq('is_active', true)
      .limit(1);
    if (error) throw error;

    const row = asRows(data)[0];
    if (!row) return { status: 'error' };

    const company = asEmbeddedRecord(row['companies']);
    const id = asString(company['id']);
    if (!id) return { status: 'error' };

    return {
      status: 'ok',
      company: {
        id,
        name: asString(company['name']),
        slug: asString(company['slug']),
        status: asString(company['status'], 'unverified'),
        vatNumber: asNullableString(company['vat_number']),
        verifiedAt: asNullableString(company['verified_at']),
        canEdit: active.activeRole === 'owner' || active.activeRole === 'admin',
      },
    };
  } catch (error) {
    captureError(error, { area: 'company.getMyCompany' });
    return { status: 'error' };
  }
}
