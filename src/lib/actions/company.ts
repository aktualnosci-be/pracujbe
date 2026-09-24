'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { ACTIVE_COMPANY_COOKIE, getActiveCompany } from '@/lib/company-context';
import { mapTeamError, type TeamError } from '@/lib/team/errors';

/** UUID v4 (walidacja identyfikatorów przekazywanych z klienta). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  companyFormSchema,
  companyUpdateSchema,
  type CompanyFormInput,
  type CompanyUpdateInput,
} from '@/lib/validation/company';

/**
 * Server Actions profilu firmy pracodawcy — Pracuj.be (Etap 4).
 *
 *   - `createCompany` — zakłada PIERWSZĄ firmę pracodawcy (status wymuszony `unverified`) razem
 *                        z VAT/KBO i właścicielem w jednej transakcji — RPC `create_first_company`
 *                        (0072; idempotentne: ponowne kliknięcie zwraca tę samą firmę).
 *   - `updateCompany` — aktualizuje dane firmy aktywnego członkostwa (RLS `companies_update_member`).
 *                        Statusu nie ustawia; zmiana nazwy/VAT zweryfikowanej firmy przywraca
 *                        w bazie status `pending` (trigger `protect_company_verification`, 0072).
 *   - `createAdditionalCompany` — KOLEJNA firma zalogowanego pracodawcy (#403) — RPC
 *                        `create_additional_company` (0086: owner, limit 5 firm, audyt,
 *                        idempotentne dla podwójnego kliknięcia); nowa firma staje się aktywna.
 *   - `requestCompanyReverification` — odrzucona firma wraca do kolejki weryfikacji admina
 *                        (RPC `request_company_reverification`, 0072).
 *
 * Zapis idzie pod SESJĄ użytkownika (RLS, NIGDY service-role). Walidacja Zod (te same schematy
 * co formularz). Błędy mapowane na stabilny `ErrorCode` — bez technikaliów (Invariant #8).
 * Rate limiting per IP (fail-open). Bez env → tryb DEMO (`{ ok: true, demo: true }`), build/UX
 * działa bez backendu.
 */

export type CreateCompanyResult =
  { ok: true; id: string; demo?: boolean } | { ok: false; error: ErrorCode };
export type UpdateCompanyResult =
  | { ok: true; demo?: boolean; reverificationRequired?: boolean }
  | { ok: false; error: ErrorCode };
export type AddCompanyResult =
  { ok: true; id: string; demo?: boolean } | { ok: false; error: TeamError };
export type ReverificationResult =
  { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };

/** Syntetyczny identyfikator firmy w trybie DEMO (brak env). */
const DEMO_COMPANY_ID = 'demo-company';

/** Limity (okno 1 h) — ochrona przed masowym zakładaniem/edycją firm. */
const CREATE_RATE_MAX = 10;
const UPDATE_RATE_MAX = 60;
const REVERIFY_RATE_MAX = 10;
const RATE_WINDOW_SECONDS = 3600;

/* ---------------------------------------------------------------------------
 * Pomocnicze
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('COMPANY_STATUS_INVALID')) return 'INVALID_TRANSITION';
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

/**
 * Ustawia aktywną firmę użytkownika (FUN-07). Waliduje AKTYWNE członkostwo w danej firmie
 * (nie ufamy wartości od klienta), zapisuje cookie i odświeża panel. Zwraca `{ ok }`.
 */
export async function setActiveCompany(
  companyId: string,
): Promise<{ ok: boolean }> {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId))
    return { ok: false };
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
 * Zakłada pierwszą firmę zalogowanego pracodawcy (status `unverified`) i zwraca jej `id`.
 * Numer VAT/KBO zapisuje się w tej samej transakcji co firma (#368) — błąd zapisu
 * nie daje „czystego" sukcesu. Ponowne wywołanie zwraca już istniejącą firmę (#365).
 */
export async function createCompany(
  input: CompanyFormInput,
): Promise<CreateCompanyResult> {
  const parsed = companyFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  if (!isSupabaseConfigured()) {
    return { ok: true, id: DEMO_COMPANY_ID, demo: true };
  }

  // Rate limit per IP — ochrona przed masowym zakładaniem firm.
  if (
    !(await checkRateLimit('company-create', {
      max: CREATE_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { data, error } = await supabase.rpc('create_first_company', {
      p_name: v.name,
      p_slug: companySlug(v.name),
      p_vat_number: nullIfEmpty(v.vatNumber),
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

    const row = asRecord(Array.isArray(data) ? data[0] : data);
    const id = asString(row['company_id']);
    if (!id) return { ok: false, error: 'INTERNAL' };

    return { ok: true, id };
  } catch (e) {
    captureError(e, { area: 'company.createCompany' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * createAdditionalCompany
 * ------------------------------------------------------------------------- */

/**
 * Zakłada KOLEJNĄ firmę (#403) z użytkownikiem jako ownerem i przełącza na nią panel.
 * Limit liczby firm i idempotencję egzekwuje baza; tu walidacja + limit per IP.
 */
export async function createAdditionalCompany(
  input: CompanyFormInput,
): Promise<AddCompanyResult> {
  const parsed = companyFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  if (!isSupabaseConfigured()) return { ok: true, id: DEMO_COMPANY_ID, demo: true };

  if (
    !(await checkRateLimit('company-create', {
      max: CREATE_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const { data, error } = await supabase.rpc('create_additional_company', {
      p_name: v.name,
      p_slug: companySlug(v.name),
      p_vat_number: nullIfEmpty(v.vatNumber),
    });
    if (error) return { ok: false, error: mapTeamError(error.message) };

    const row = asRecord(Array.isArray(data) ? data[0] : data);
    const id = asString(row['company_id']);
    if (!UUID_RE.test(id)) return { ok: false, error: 'INTERNAL' };

    (await cookies()).set(ACTIVE_COMPANY_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath('/employer', 'layout');
    return { ok: true, id };
  } catch (e) {
    captureError(e, { area: 'company.createAdditionalCompany' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * updateCompany
 * ------------------------------------------------------------------------- */

/**
 * Aktualizuje dane aktywnej firmy zalogowanego (nazwa i/lub VAT). Nie ustawia statusu ani
 * sluga (stabilny w publicznych URL). Puste pola pomija; pusty VAT czyści wartość.
 * Zmiana nazwy/VAT zweryfikowanej firmy wraca do weryfikacji (baza, 0072) — wynik niesie
 * wtedy `reverificationRequired`, by formularz powiedział o tym wprost.
 */
export async function updateCompany(
  input: CompanyUpdateInput,
): Promise<UpdateCompanyResult> {
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
  if (
    !(await checkRateLimit('company-update', {
      max: UPDATE_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const active = await getActiveCompany(supabase, user.id);
    const companyId = active.activeId;
    if (!companyId) return { ok: false, error: 'NOT_FOUND' };
    if (active.activeRole !== 'owner' && active.activeRole !== 'admin') {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    // RLS `companies_update_member` + trigger `protect_company_verification` (status nietykalny).
    const { data, error } = await supabase
      .from('companies')
      .update(patch)
      .eq('id', companyId)
      .select('id, status');
    if (error) return { ok: false, error: mapPgError(error.message) };
    if (
      !Array.isArray(data) ||
      data.length !== 1 ||
      asString(asRecord(data[0])['id']) !== companyId
    ) {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    const newStatus = asString(asRecord(data[0])['status']);
    if (active.activeStatus === 'verified' && newStatus === 'pending') {
      return { ok: true, reverificationRequired: true };
    }
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'company.updateCompany' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * requestCompanyReverification
 * ------------------------------------------------------------------------- */

/**
 * Ponownie zgłasza ODRZUCONĄ aktywną firmę do weryfikacji (#400): `rejected → pending`,
 * firma wraca do kolejki admina. Tylko owner/admin firmy; inne stany → `INVALID_TRANSITION`
 * (zawieszenie zdejmuje wyłącznie administrator). Autoryzację i przejście egzekwuje RPC.
 */
export async function requestCompanyReverification(): Promise<ReverificationResult> {
  if (!isSupabaseConfigured()) return { ok: true, demo: true };

  if (
    !(await checkRateLimit('company-reverify', {
      max: REVERIFY_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const active = await getActiveCompany(supabase, user.id);
    if (!active.activeId) return { ok: false, error: 'NOT_FOUND' };
    if (active.activeRole !== 'owner' && active.activeRole !== 'admin') {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    const { error } = await supabase.rpc('request_company_reverification', {
      p_company_id: active.activeId,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

    revalidatePath('/employer', 'layout');
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'company.requestCompanyReverification' });
    return { ok: false, error: 'INTERNAL' };
  }
}
