'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { ACTIVE_COMPANY_COOKIE, getActiveCompanyId } from '@/lib/company-context';

/** UUID v4 (walidacja identyfikatorów przekazywanych z klienta). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  companyFormSchema,
  companyUpdateSchema,
  type CompanyFormInput,
  type CompanyUpdateInput,
} from '@/lib/validation/company';

/**
 * Server Actions profilu firmy pracodawcy — Pracuj.be (Etap 4).
 *
 *   - `createCompany` — tworzy firmę (status wymuszony `unverified`) + właściciela atomowo
 *                        przez RPC `create_company_with_owner`; opcjonalnie dopisuje VAT/KBO.
 *   - `updateCompany` — aktualizuje dane firmy aktywnego członkostwa (RLS `companies_update_member`).
 *                        NIGDY nie tyka statusu/weryfikacji (chroni trigger `protect_company_verification`).
 *
 * Zapis idzie pod SESJĄ użytkownika (RLS, NIGDY service-role). Walidacja Zod (te same schematy
 * co formularz). Błędy mapowane na stabilny `ErrorCode` — bez technikaliów (Invariant #8).
 * Rate limiting per IP (fail-open). Bez env → tryb DEMO (`{ ok: true, demo: true }`), build/UX
 * działa bez backendu.
 */

export type CreateCompanyResult =
  | { ok: true; id: string; demo?: boolean }
  | { ok: false; error: ErrorCode };
export type UpdateCompanyResult = { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };

/** Syntetyczny identyfikator firmy w trybie DEMO (brak env). */
const DEMO_COMPANY_ID = 'demo-company';

/** Limity (okno 1 h) — ochrona przed masowym zakładaniem/edycją firm. */
const CREATE_RATE_MAX = 10;
const UPDATE_RATE_MAX = 60;
const RATE_WINDOW_SECONDS = 3600;

/* ---------------------------------------------------------------------------
 * Pomocnicze
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
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

/** Rdzeń sluga (bez diakrytyków) + losowy sufiks (slug `companies` jest UNIQUE). */
function companySlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : `firma-${suffix}`;
}

/** Puste/whitespace → null; inaczej przycięta wartość. */
function nullIfEmpty(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Id aktywnej firmy zalogowanego (cookie-aware, zwalidowane — FUN-07) albo null. */
async function activeCompanyId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  return getActiveCompanyId(supabase, userId);
}

/**
 * Ustawia aktywną firmę użytkownika (FUN-07). Waliduje AKTYWNE członkostwo w danej firmie
 * (nie ufamy wartości od klienta), zapisuje cookie i odświeża panel. Zwraca `{ ok }`.
 */
export async function setActiveCompany(companyId: string): Promise<{ ok: boolean }> {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) return { ok: false };
  if (!isSupabaseConfigured()) return { ok: true }; // demo: bez sesji nie utrwalamy

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };

    // Autoryzacja: użytkownik musi mieć AKTYWNE członkostwo w tej firmie.
    const { data, error } = await supabase
      .from('company_members')
      .select('id')
      .eq('profile_id', user.id)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(1);
    if (error || !asRecord((data ?? [])[0])['id']) return { ok: false };

    const store = await cookies();
    store.set(ACTIVE_COMPANY_COOKIE, companyId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath('/employer', 'layout');
    return { ok: true };
  } catch (error) {
    captureError(error, { area: 'company.setActiveCompany' });
    return { ok: false };
  }
}

/* ---------------------------------------------------------------------------
 * createCompany
 * ------------------------------------------------------------------------- */

/**
 * Tworzy firmę zalogowanego użytkownika (status `unverified`) i zwraca jej `id`.
 * Opcjonalny numer VAT/KBO dopisywany jest po utworzeniu (RLS: członek firmy).
 */
export async function createCompany(input: CompanyFormInput): Promise<CreateCompanyResult> {
  const parsed = companyFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  if (!isSupabaseConfigured()) {
    return { ok: true, id: DEMO_COMPANY_ID, demo: true };
  }

  // Rate limit per IP — ochrona przed masowym zakładaniem firm.
  if (!(await checkRateLimit('company-create', { max: CREATE_RATE_MAX, windowSeconds: RATE_WINDOW_SECONDS }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { data, error } = await supabase.rpc('create_company_with_owner', {
      p_name: v.name,
      p_slug: companySlug(v.name),
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

    const id = asString(data);
    if (!id) return { ok: false, error: 'INTERNAL' };

    // Numer VAT/KBO nie jest częścią RPC — dopisujemy osobno (best-effort, nie blokuje sukcesu).
    const vat = nullIfEmpty(v.vatNumber);
    if (vat) {
      const { error: vatErr } = await supabase
        .from('companies')
        .update({ vat_number: vat })
        .eq('id', id);
      if (vatErr) captureError(vatErr, { area: 'company.createCompany.vat', id });
    }

    return { ok: true, id };
  } catch (e) {
    captureError(e, { area: 'company.createCompany' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * updateCompany
 * ------------------------------------------------------------------------- */

/**
 * Aktualizuje dane aktywnej firmy zalogowanego (nazwa i/lub VAT). NIE zmienia statusu ani
 * sluga (stabilny w publicznych URL). Puste pola pomija; pusty VAT czyści wartość.
 */
export async function updateCompany(input: CompanyUpdateInput): Promise<UpdateCompanyResult> {
  const parsed = companyUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  // Zbuduj patch tylko z pól obecnych w wejściu (nazwa niepusta; VAT: wartość albo null).
  const patch: Record<string, unknown> = {};
  if (v.name !== undefined) patch['name'] = v.name;
  if (v.vatNumber !== undefined) patch['vat_number'] = nullIfEmpty(v.vatNumber);
  if (Object.keys(patch).length === 0) return { ok: true }; // nic do zapisania

  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  // Rate limit per IP — łagodny (edycja to częsta akcja).
  if (!(await checkRateLimit('company-update', { max: UPDATE_RATE_MAX, windowSeconds: RATE_WINDOW_SECONDS }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const companyId = await activeCompanyId(supabase, user.id);
    if (!companyId) return { ok: false, error: 'NOT_FOUND' };

    // RLS `companies_update_member` + trigger `protect_company_verification` (status nietykalny).
    const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
    if (error) return { ok: false, error: mapPgError(error.message) };

    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'company.updateCompany' });
    return { ok: false, error: 'INTERNAL' };
  }
}
