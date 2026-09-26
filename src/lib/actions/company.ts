'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { execute, queryOne, rpc, rpcRows } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import {
  ACTIVE_COMPANY_COOKIE,
  getActiveCompany,
  type ActiveCompanyContext,
} from '@/lib/company-context';
import { mapTeamError, type TeamError } from '@/lib/team/errors';

/** UUID v4 (walidacja identyfikatorów przekazywanych z klienta). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  companyFormSchema,
  companyLinksUpdateSchema,
  companyUpdateSchema,
  type CompanyFormInput,
  type CompanyLinksUpdateInput,
  type CompanyUpdateInput,
} from '@/lib/validation/company';

/**
 * Server Actions profilu firmy pracodawcy — Pracuj.be (Etap 4).
 *
 *   - `createCompany` — zakłada PIERWSZĄ firmę pracodawcy (status wymuszony `unverified`) razem
 *                        z VAT/KBO i właścicielem w jednej transakcji — RPC `create_first_company`
 *                        (0072; idempotentne: ponowne kliknięcie zwraca tę samą firmę).
 *   - `updateCompany` — aktualizuje dane firmy aktywnego członkostwa (UPDATE pod RLS
 *                        `companies_update_member`: tylko owner/admin, 0040).
 *                        Statusu nie ustawia; zmiana nazwy/VAT zweryfikowanej firmy przywraca
 *                        w bazie status `pending` (trigger `protect_company_verification`, 0072).
 *   - `updateCompanyLinks` — ustawia/czyści stronę WWW i adres logo (#112); ta sama ścieżka
 *                        zapisu, ale NIE cofa weryfikacji (baza reaguje tylko na nazwę/VAT).
 *   - `createAdditionalCompany` — KOLEJNA firma zalogowanego pracodawcy (#403) — RPC
 *                        `create_additional_company` (0086: owner, limit 5 firm, audyt,
 *                        idempotentne dla podwójnego kliknięcia); nowa firma staje się aktywna.
 *   - `requestCompanyReverification` — odrzucona firma wraca do kolejki weryfikacji admina
 *                        (RPC `request_company_reverification`, 0072).
 *
 * Zapis idzie pod SESJĄ użytkownika (`withPortalTransaction` — RLS, NIGDY service-role).
 * Walidacja Zod (te same schematy
 * co formularz). Błędy mapowane na stabilny `ErrorCode` — bez technikaliów (Invariant #8).
 * Rate limiting per IP (fail-open). Bez env → tryb DEMO (`{ ok: true, demo: true }`), build/UX
 * działa bez backendu.
 */

export type CreateCompanyResult =
  { ok: true; id: string; demo?: boolean } | { ok: false; error: ErrorCode };
export type UpdateCompanyResult =
  | { ok: true; demo?: boolean; reverificationRequired?: boolean }
  | { ok: false; error: ErrorCode };
export type UpdateCompanyLinksResult =
  { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };
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

/** Wyjątek transakcji → kod użytkowy (błąd bazy wg komunikatu; reszta → kanał błędów + INTERNAL). */
function failureCode(error: unknown, area: string): ErrorCode {
  if (isDatabaseError(error)) return mapPgError(databaseErrorMessage(error));
  captureError(error, { area });
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
  if (!isPortalDataConfigured()) return { ok: true }; // demo: bez sesji nie utrwalamy

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false };

    // Autoryzacja: użytkownik musi mieć AKTYWNE członkostwo w tej firmie (RLS: własne wiersze).
    const member = await withPortalTransaction(me, (tx) =>
      queryOne<Record<string, unknown>>(tx, 'company.active-membership',
        `SELECT id FROM public.company_members
          WHERE profile_id = $1 AND company_id = $2 AND is_active = true
          LIMIT 1`, [me.id, companyId]),
    );
    if (!asRecord(member)['id']) return { ok: false };

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

  if (!isPortalDataConfigured()) {
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
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const data = await withPortalTransaction(me, (tx) =>
      rpcRows(tx, 'create_first_company', {
        p_name: v.name,
        p_slug: companySlug(v.name),
        p_vat_number: nullIfEmpty(v.vatNumber),
      }),
    );

    const id = asString(asRecord(data[0])['company_id']);
    if (!id) return { ok: false, error: 'INTERNAL' };

    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: failureCode(e, 'company.createCompany') };
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

  if (!isPortalDataConfigured()) return { ok: true, id: DEMO_COMPANY_ID, demo: true };

  if (
    !(await checkRateLimit('company-create', {
      max: CREATE_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    let data: Record<string, unknown>[];
    try {
      data = await withPortalTransaction(me, (tx) =>
        rpcRows(tx, 'create_additional_company', {
          p_name: v.name,
          p_slug: companySlug(v.name),
          p_vat_number: nullIfEmpty(v.vatNumber),
        }),
      );
    } catch (e) {
      if (isDatabaseError(e)) return { ok: false, error: mapTeamError(databaseErrorMessage(e)) };
      throw e;
    }

    const id = asString(asRecord(data[0])['company_id']);
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

  // Zapis tylko pól obecnych w wejściu (nazwa niepusta; VAT: wartość albo null).
  const setName = v.name !== undefined;
  const setVat = v.vatNumber !== undefined;
  if (!setName && !setVat) return { ok: true }; // nic do zapisania

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

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
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    type Outcome =
      | { error: ErrorCode }
      | { error: null; active: ActiveCompanyContext; companyId: string; rows: Record<string, unknown>[] };
    const outcome = await withPortalTransaction(me, async (tx): Promise<Outcome> => {
      const active = await getActiveCompany(tx, me.id);
      const companyId = active.activeId;
      if (!companyId) return { error: 'NOT_FOUND' };
      if (active.activeRole !== 'owner' && active.activeRole !== 'admin') {
        return { error: 'PERMISSION_DENIED' };
      }

      // RLS `companies_update_member` (owner/admin) + trigger `protect_company_verification`
      // (status nietykalny; zmiana nazwy/VAT zweryfikowanej firmy → pending).
      const { rows } = await execute(tx, 'company.update',
        `UPDATE public.companies
            SET name = CASE WHEN $2 THEN $3 ELSE name END,
                vat_number = CASE WHEN $4 THEN $5 ELSE vat_number END
          WHERE id = $1
          RETURNING id, status::text AS status`,
        [companyId, setName, setName ? v.name : null, setVat, setVat ? nullIfEmpty(v.vatNumber) : null]);
      return { error: null, active, companyId, rows };
    });
    if (outcome.error !== null) return { ok: false, error: outcome.error };

    const { active, companyId, rows } = outcome;
    // RLS przepuszcza UPDATE bez wiersza (0 rows) — to nie jest sukces.
    if (rows.length !== 1 || asString(asRecord(rows[0])['id']) !== companyId) {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    const newStatus = asString(asRecord(rows[0])['status']);
    if (active.activeStatus === 'verified' && newStatus === 'pending') {
      return { ok: true, reverificationRequired: true };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: failureCode(e, 'company.updateCompany') };
  }
}

/* ---------------------------------------------------------------------------
 * updateCompanyLinks
 * ------------------------------------------------------------------------- */

/**
 * Ustawia/czyści stronę WWW i adres logo aktywnej firmy (#112). Osobna akcja od
 * `updateCompany`: te pola NIE cofają weryfikacji (w przeciwieństwie do nazwy/VAT) — baza
 * to gwarantuje (`protect_company_verification` reaguje tylko na `name`/`vat_number`, 0072),
 * tu więc bez odczytu/porównania statusu przed i po. Ta sama ścieżka zapisu co `updateCompany`
 * (UPDATE pod RLS `companies_update_member`: tylko owner/admin, 0040); baza waliduje adres
 * drugi raz (CHECK `public_https_url`, 0141) i audytuje zmianę (`company.links_changed`).
 */
export async function updateCompanyLinks(
  input: CompanyLinksUpdateInput,
): Promise<UpdateCompanyLinksResult> {
  const parsed = companyLinksUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  const setWebsite = v.website !== undefined;
  const setLogoUrl = v.logoUrl !== undefined;
  if (!setWebsite && !setLogoUrl) return { ok: true }; // nic do zapisania

  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  if (
    !(await checkRateLimit('company-update', {
      max: UPDATE_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    type Outcome =
      | { error: ErrorCode }
      | { error: null; companyId: string; rows: Record<string, unknown>[] };
    const outcome = await withPortalTransaction(me, async (tx): Promise<Outcome> => {
      const active = await getActiveCompany(tx, me.id);
      const companyId = active.activeId;
      if (!companyId) return { error: 'NOT_FOUND' };
      if (active.activeRole !== 'owner' && active.activeRole !== 'admin') {
        return { error: 'PERMISSION_DENIED' };
      }

      // RLS `companies_update_member` (owner/admin) + CHECK `companies_website_https`/
      // `companies_logo_url_https` (0141) — status/weryfikacja bez zmian (trigger nie reaguje).
      const { rows } = await execute(tx, 'company.update-links',
        `UPDATE public.companies
            SET website  = CASE WHEN $2 THEN $3 ELSE website  END,
                logo_url = CASE WHEN $4 THEN $5 ELSE logo_url END
          WHERE id = $1
          RETURNING id`,
        [
          companyId,
          setWebsite, setWebsite ? nullIfEmpty(v.website) : null,
          setLogoUrl, setLogoUrl ? nullIfEmpty(v.logoUrl) : null,
        ]);
      return { error: null, companyId, rows };
    });
    if (outcome.error !== null) return { ok: false, error: outcome.error };

    // RLS przepuszcza UPDATE bez wiersza (0 rows) — to nie jest sukces.
    if (outcome.rows.length !== 1 || asString(asRecord(outcome.rows[0])['id']) !== outcome.companyId) {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: failureCode(e, 'company.updateCompanyLinks') };
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
  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  if (
    !(await checkRateLimit('company-reverify', {
      max: REVERIFY_RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    const outcome = await withPortalTransaction(me, async (tx): Promise<ErrorCode | null> => {
      const active = await getActiveCompany(tx, me.id);
      if (!active.activeId) return 'NOT_FOUND';
      if (active.activeRole !== 'owner' && active.activeRole !== 'admin') {
        return 'PERMISSION_DENIED';
      }
      await rpc(tx, 'request_company_reverification', { p_company_id: active.activeId });
      return null;
    });
    if (outcome) return { ok: false, error: outcome };

    revalidatePath('/employer', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: failureCode(e, 'company.requestCompanyReverification') };
  }
}
