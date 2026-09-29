'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { execute, queryOne, rpc, rpcRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { ACTIVE_COMPANY_COOKIE, activeCompanyCookieOptions, getExpectedActiveCompany } from '@/lib/company-context';
import { mapTeamError, type TeamError } from '@/lib/team/errors';
import { scheduleCompanyViesAutoCheck } from '@/lib/vies/auto-check';

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
 *   - `updateCompanyLinks` — zgłasza stronę WWW i adres logo (#112); nowy adres czeka na
 *                        decyzję admina (RPC `submit_company_links`, 0156), NIE cofa weryfikacji.
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
/** Wynik zgłoszenia linków firmy (0156): czeka na admina / weszło od razu / bez zmian. */
export type CompanyLinksOutcome = 'pending' | 'applied' | 'unchanged';
export type UpdateCompanyLinksResult =
  | { ok: true; demo?: boolean; outcome: CompanyLinksOutcome }
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

/** Wyjątek transakcji → kod użytkowy (błąd bazy wg komunikatu; reszta → kanał błędów + INTERNAL). */
function failureCode(error: unknown, area: string): ErrorCode {
  if (isDatabaseError(error)) return reportUnmappedDbError(error, area, mapPgError(databaseErrorMessage(error)));
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
 * Aktywne członkostwo zalogowanego we WSKAZANEJ firmie (#801). `updateCompany`/
 * `updateCompanyLinks` dostają `companyId` z formularza, wyrenderowanego dla konkretnej
 * firmy — NIGDY z cookie aktywnej firmy w chwili zapisu: wybór aktywnej firmy jest wspólny
 * dla wszystkich kart tej samej przeglądarki, więc zmiana firmy w innej karcie po
 * wyrenderowaniu formularza nie może przekierować zapisu do innego rekordu. `null`, gdy
 * użytkownik nie ma aktywnego członkostwa w TEJ firmie (obca/nieistniejąca firma, usunięte
 * członkostwo) — RLS i tak odrzuciłaby zapis, ale sprawdzamy explicite, by zwrócić stabilny
 * kod błędu zamiast liczyć na `0 rows`.
 */
async function getCompanyMembershipFor(
  tx: TransactionQuery,
  profileId: string,
  companyId: string,
): Promise<{ role: string; status: string } | null> {
  const row = await queryOne<Record<string, unknown>>(tx, 'company.membership-for-company',
    `SELECT m.role, c.status::text AS status
       FROM public.company_members m
       JOIN public.companies c ON c.id = m.company_id
      WHERE m.profile_id = $1 AND m.company_id = $2 AND m.is_active = true
      LIMIT 1`, [profileId, companyId]);
  if (!row) return null;
  return { role: asString(row['role'], 'member'), status: asString(row['status'], 'unverified') };
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
    store.set(ACTIVE_COMPANY_COOKIE, companyId, activeCompanyCookieOptions());
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

    // VIES po założeniu (26.09.2026): po odpowiedzi, serwerowo; awaria niczego nie blokuje.
    scheduleCompanyViesAutoCheck(id);
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
      if (isDatabaseError(e)) {
        return {
          ok: false,
          error: reportUnmappedDbError(e, 'company.createAdditionalCompany', mapTeamError(databaseErrorMessage(e))),
        };
      }
      throw e;
    }

    const id = asString(asRecord(data[0])['company_id']);
    if (!UUID_RE.test(id)) return { ok: false, error: 'INTERNAL' };

    (await cookies()).set(ACTIVE_COMPANY_COOKIE, id, activeCompanyCookieOptions());
    revalidatePath('/employer', 'layout');
    scheduleCompanyViesAutoCheck(id);
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
 * Aktualizuje dane firmy WSKAZANEJ przez `companyId` (nazwa i/lub VAT) — nie sięga po
 * aktywną firmę z cookie. Formularz jest wyrenderowany dla konkretnej firmy (#801):
 * `companyId` przychodzi z tej samej odpowiedzi serwera co wartości początkowe, więc zmiana
 * aktywnej firmy w innej karcie po wyrenderowaniu formularza nie może przekierować zapisu do
 * innego rekordu. Nie ustawia statusu ani sluga (stabilny w publicznych URL). Puste pola
 * pomija; pusty VAT czyści wartość. Zmiana nazwy/VAT zweryfikowanej firmy wraca do
 * weryfikacji (baza, 0072) — wynik niesie wtedy `reverificationRequired`, by formularz
 * powiedział o tym wprost.
 */
export async function updateCompany(
  companyId: string,
  input: CompanyUpdateInput,
): Promise<UpdateCompanyResult> {
  const parsed = companyUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  // Zapis tylko pól obecnych w wejściu (nazwa niepusta; VAT: wartość albo null).
  const setName = v.name !== undefined;
  const setVat = v.vatNumber !== undefined;
  if (!setName && !setVat) return { ok: true }; // nic do zapisania

  // Demo (bez bazy) używa nierzeczywistego identyfikatora (`DEMO_COMPANY.id`) — sprawdzamy
  // format UUID dopiero DALEJ, żeby panel demonstracyjny nie dostawał NOT_FOUND.
  if (!isPortalDataConfigured()) return { ok: true, demo: true };

  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return { ok: false, error: 'NOT_FOUND' };
  }

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
      | { error: null; statusBefore: string; rows: Record<string, unknown>[] };
    const outcome = await withPortalTransaction(me, async (tx): Promise<Outcome> => {
      const membership = await getCompanyMembershipFor(tx, me.id, companyId);
      if (!membership) return { error: 'NOT_FOUND' };
      if (membership.role !== 'owner' && membership.role !== 'admin') {
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
      return { error: null, statusBefore: membership.status, rows };
    });
    if (outcome.error !== null) return { ok: false, error: outcome.error };

    const { statusBefore, rows } = outcome;
    // RLS przepuszcza UPDATE bez wiersza (0 rows) — to nie jest sukces.
    if (rows.length !== 1 || asString(asRecord(rows[0])['id']) !== companyId) {
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    const newStatus = asString(asRecord(rows[0])['status']);
    if (statusBefore === 'verified' && newStatus === 'pending') {
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
 * Zgłasza stronę WWW i adres logo firmy WSKAZANEJ przez `companyId` (#112) — nie sięga po
 * aktywną firmę z cookie. Formularz jest wyrenderowany dla konkretnej firmy (#801): zmiana
 * aktywnej firmy w innej karcie po wyrenderowaniu formularza nie może przekierować zapisu do
 * innego rekordu. Od 0156 z zatwierdzaniem przez admina portalu. Osobna akcja od
 * `updateCompany`: te pola NIE cofają weryfikacji firmy (w przeciwieństwie do nazwy/VAT —
 * `protect_company_verification`, 0072). Tylko owner/admin WSKAZANEJ firmy; RPC
 * `submit_company_links` (pod sesją, SECURITY DEFINER) sprawdza rolę drugi raz, waliduje
 * adresy (`public_https_url`) i decyduje o wyniku:
 *   - `pending`   — nowy adres czeka na decyzję admina; pola publiczne bez zmian,
 *   - `applied`   — propozycja tylko usuwa adres (nic nowego nie publikuje) — wchodzi od razu,
 *   - `unchanged` — propozycja = zatwierdzony stan (wycofuje ewentualną propozycję).
 * Bezpośredni zapis kolumn przez klienta blokuje w bazie strażnik `guard_company_links`.
 */
export async function updateCompanyLinks(
  companyId: string,
  input: CompanyLinksUpdateInput,
): Promise<UpdateCompanyLinksResult> {
  const parsed = companyLinksUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v = parsed.data;

  const setWebsite = v.website !== undefined;
  const setLogoUrl = v.logoUrl !== undefined;
  if (!setWebsite && !setLogoUrl) return { ok: true, outcome: 'unchanged' }; // nic do zapisania

  // Demo (bez bazy) używa nierzeczywistego identyfikatora (`DEMO_COMPANY.id`) — sprawdzamy
  // format UUID dopiero DALEJ, żeby panel demonstracyjny nie dostawał NOT_FOUND.
  if (!isPortalDataConfigured()) return { ok: true, demo: true, outcome: 'unchanged' };

  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    return { ok: false, error: 'NOT_FOUND' };
  }

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

    type Outcome = { error: ErrorCode } | { error: null; result: unknown };
    const outcome = await withPortalTransaction(me, async (tx): Promise<Outcome> => {
      const membership = await getCompanyMembershipFor(tx, me.id, companyId);
      if (!membership) return { error: 'NOT_FOUND' };
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        return { error: 'PERMISSION_DENIED' };
      }
      const result = await rpc(tx, 'submit_company_links', {
        p_company_id: companyId,
        p_set_website: setWebsite,
        p_website: setWebsite ? (nullIfEmpty(v.website) ?? '') : null,
        p_set_logo_url: setLogoUrl,
        p_logo_url: setLogoUrl ? (nullIfEmpty(v.logoUrl) ?? '') : null,
      });
      return { error: null, result };
    });
    if (outcome.error !== null) return { ok: false, error: outcome.error };

    const result = outcome.result;
    if (result !== 'pending' && result !== 'applied' && result !== 'unchanged') {
      captureError(new Error('submit_company_links: unexpected result'), {
        area: 'company.updateCompanyLinks',
      });
      return { ok: false, error: 'INTERNAL' };
    }
    revalidatePath('/employer', 'layout');
    return { ok: true, outcome: result };
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
export async function requestCompanyReverification(
  expectedCompanyId: string,
): Promise<ReverificationResult> {
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
      // EMP-02: zgłaszamy firmę pokazaną na ekranie, nie firmę przełączoną w innej karcie.
      const expected = await getExpectedActiveCompany(tx, me.id, expectedCompanyId);
      if (!expected.ok) return expected.error;
      const active = expected.context;
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
