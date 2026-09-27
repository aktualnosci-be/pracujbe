/**
 * Warstwa danych profilu firmy pracodawcy — Pracuj.be (Etap 4).
 *
 * Strategia spójna z `@/lib/data/employer`: przy skonfigurowanym backendzie
 * (`isPortalDataConfigured()`) dane czytane są pod SESJĄ zalogowanego użytkownika
 * (`withPortalTransaction` — RLS, NIGDY service-role). Bez konfiguracji (build/preview bez env)
 * zwracamy dane DEMO — firmę o statusie `verified`, dzięki czemu ekran `/employer/firma`
 * renderuje widok danych firmy (nie formularz zakładania).
 *
 * „Aktywna firma" = kontekst z `@/lib/company-context` (cookie zwalidowane względem aktywnych
 * członkostw, FUN-07), czytany w tej samej transakcji.
 */

import { isAppealStatus, parseAppealState, type AppealState, type AppealStatus } from '@/lib/admin/appeals';
import { getActiveCompany } from '@/lib/company-context';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

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
  /** Uzasadnienie admina dla odrzuconej/zawieszonej firmy (0084, #310) — inaczej null. */
  statusReason: string | null;
  /** Strona WWW firmy (#112) — bezwzględny https albo null (baza waliduje format). */
  website: string | null;
  /** Adres logo firmy (#112) — bezwzględny https albo null. */
  logoUrl: string | null;
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
  statusReason: null,
  website: 'https://example.com',
  logoUrl: null,
  canEdit: true,
};

/* ---------------------------------------------------------------------------
 * Pomocnicze parsowanie (wiersze JSON z PostgreSQL → pola typowane)
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
  if (!isPortalDataConfigured()) return { status: 'ok', company: DEMO_COMPANY };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };

    const loaded = await withPortalTransaction(me, async (tx) => {
      // AKTYWNA firma z kontekstu (cookie-aware, zwalidowana — FUN-07), nie „pierwsze członkostwo".
      const active = await getActiveCompany(tx, me.id);
      if (!active.activeId) return { active, company: null };
      // company_members_select + companies_select_member (RLS): tylko własne aktywne członkostwo.
      const company = await queryOne<Record<string, unknown>>(tx, 'company.my-company',
        `SELECT c.id, c.name, c.slug, c.status, c.status_reason, c.vat_number, c.verified_at,
                c.website, c.logo_url
           FROM public.company_members m
           JOIN public.companies c ON c.id = m.company_id
          WHERE m.profile_id = $1 AND m.company_id = $2 AND m.is_active = true
          LIMIT 1`, [me.id, active.activeId]);
      return { active, company };
    });

    const { active } = loaded;
    if (!active.activeId) return { status: 'ok', company: null };
    const company = asRecord(loaded.company);
    const id = asString(company['id']);
    if (!id) return { status: 'error' };

    const status = asString(company['status'], 'unverified');
    return {
      status: 'ok',
      company: {
        id,
        name: asString(company['name']),
        slug: asString(company['slug']),
        status,
        vatNumber: asNullableString(company['vat_number']),
        verifiedAt: asNullableString(company['verified_at']),
        statusReason:
          status === 'rejected' || status === 'suspended'
            ? asNullableString(company['status_reason'])
            : null,
        website: asNullableString(company['website']),
        logoUrl: asNullableString(company['logo_url']),
        canEdit: active.activeRole === 'owner' || active.activeRole === 'admin',
      },
    };
  } catch (error) {
    captureError(error, { area: 'company.getMyCompany' });
    return { status: 'error' };
  }
}

/** Decyzja moderacyjna dotycząca firmy lub jej oferty (#42) — uzasadnienie dla autora. */
export interface CompanyModerationDecision {
  id: string;
  reference: string;
  /** `job_removed` | `company_suspended`. */
  decision: string;
  jobTitle: string | null;
  facts: string;
  groundType: string | null;
  groundReference: string | null;
  automatedDetection: boolean;
  decidedAt: string;
  restoredAt: string | null;
  restoreReason: string | null;
  /** Droga odwołania (#43, `moderation_appealable`): `OK` = można się odwołać. */
  appealState: AppealState | null;
  /** Koniec terminu odwołania; null = termin jeszcze nie biegnie (brak poinformowania). */
  appealDeadline: string | null;
  /** Własne odwołanie autora od tej decyzji albo null. */
  appeal: CompanyModerationAppeal | null;
}

export interface CompanyModerationAppeal {
  id: string;
  reference: string;
  status: AppealStatus;
  submittedAt: string;
  dueAt: string | null;
  decidedAt: string | null;
  reasoning: string | null;
}

export type CompanyModerationLoad =
  | { status: 'ok'; decisions: CompanyModerationDecision[] }
  | { status: 'error' };

/**
 * Decyzje moderacyjne wobec firmy i jej ofert (RPC `get_company_moderation_decisions`, 0099):
 * tylko aktywny owner/admin firmy dostaje wiersze (inni — pusta lista). Bez env → brak decyzji.
 */
export async function getCompanyModerationDecisions(companyId: string): Promise<CompanyModerationLoad> {
  if (!isPortalDataConfigured()) return { status: 'ok', decisions: [] };
  try {
    const me = await getPortalIdentity();
    // Gość nie ma prawa wykonania RPC (tylko authenticated) — ten sam wynik bez połączenia.
    if (!me) return { status: 'error' };
    const data = await withPortalTransaction(me, (tx) =>
      rpcRows(tx, 'get_company_moderation_decisions', { p_company_id: companyId }),
    );
    return {
      status: 'ok',
      decisions: asRows(data).map((row) => ({
        id: asString(row['id']),
        reference: asString(row['reference']),
        decision: asString(row['decision']),
        jobTitle: asNullableString(row['job_title']),
        facts: asString(row['facts']),
        groundType: asNullableString(row['ground_type']),
        groundReference: asNullableString(row['ground_reference']),
        automatedDetection: row['automated_detection'] === true,
        decidedAt: asString(row['decided_at']),
        restoredAt: asNullableString(row['restored_at']),
        restoreReason: asNullableString(row['restore_reason']),
        appealState: parseAppealState(row['appeal_state']),
        appealDeadline: asNullableString(row['appeal_deadline']),
        appeal:
          typeof row['appeal_id'] === 'string' && isAppealStatus(row['appeal_status'])
            ? {
                id: row['appeal_id'],
                reference: asString(row['appeal_reference']),
                status: row['appeal_status'],
                submittedAt: asString(row['appeal_submitted_at']),
                dueAt: asNullableString(row['appeal_due_at']),
                decidedAt: asNullableString(row['appeal_decided_at']),
                reasoning: asNullableString(row['appeal_reasoning']),
              }
            : null,
      })),
    };
  } catch (error) {
    captureError(error, { area: 'company.getCompanyModerationDecisions' });
    return { status: 'error' };
  }
}
