/**
 * Kontrakt soft-delete dla funkcji SECURITY DEFINER (#1111, DC-06; migracje 0189 i 0978).
 *
 * Funkcja SECURITY DEFINER omija RLS, więc warunek `deleted_at IS NULL` z polityk odczytu jej nie
 * obejmuje. Strażnik czyta NAJNOWSZĄ definicję każdej funkcji z migracji (kolejność jak
 * scripts/db/production-migrations.mjs, `drop function` usuwa definicję) i dla każdej pary
 * (funkcja SECURITY DEFINER, tabela z kolumną `deleted_at`) wymaga jednego z:
 *   - warunku na `deleted_at` tej tabeli (alias tabeli z FROM/JOIN/UPDATE albo nazwa bez aliasu),
 *   - wywołania funkcji pomocniczej, która sama sprawdza `deleted_at` tej tabeli (DELEGATES),
 *   - wpisu w EXCEPTIONS z uzasadnieniem (lista nie może zawierać wpisów nieaktualnych).
 * Nowa funkcja albo nowa tabela z `deleted_at` bez warunku = czerwony test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['database/bootstrap', 'supabase/migrations', 'database/auth'];

type FnDef = { file: string; body: string; securityDefiner: boolean };

function migrationFiles(): { name: string; sql: string }[] {
  return DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => ({ name: f, sql: readFileSync(join(ROOT, dir, f), 'utf8') })),
  ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

function qualified(name: string): string {
  const n = name.toLowerCase().replace(/"/g, '');
  return n.includes('.') ? n : `public.${n}`;
}

/** Najnowsze definicje funkcji (po nazwie; drop usuwa wszystkie przeciążenia tej nazwy). */
export function latestFunctions(files: { name: string; sql: string }[]): Map<string, FnDef> {
  const defs = new Map<string, FnDef>();
  for (const { name, sql } of files) {
    const events: { at: number; drop?: string; create?: RegExpExecArray }[] = [];
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([\w."]+)\s*\(/gi)) {
      events.push({ at: m.index ?? 0, drop: m[1] });
    }
    const re = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) events.push({ at: m.index, create: m });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.drop) {
        defs.delete(qualified(e.drop));
        continue;
      }
      const c = e.create!;
      const rest = sql.slice(c.index);
      const tag = rest.match(/\$[A-Za-z_]*\$/);
      if (!tag || tag.index === undefined) continue;
      const start = tag.index + tag[0].length;
      const end = rest.indexOf(tag[0], start);
      if (end < 0) continue;
      const semi = rest.indexOf(';', end + tag[0].length);
      const attrs = rest.slice(0, tag.index) + rest.slice(end, semi < 0 ? undefined : semi);
      defs.set(qualified(c[1]!), {
        file: name,
        body: rest.slice(start, end),
        securityDefiner: /security\s+definer/i.test(stripComments(attrs)),
      });
    }
  }
  return defs;
}

function closingParen(sql: string, open: number): number {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return i;
  }
  return sql.length;
}

/** Tabele public.* z kolumną deleted_at (create table / add column, bez usuniętych drop table). */
export function softDeleteTables(files: { name: string; sql: string }[]): Set<string> {
  const tables = new Set<string>();
  for (const { sql: raw } of files) {
    const sql = stripComments(raw);
    const events: { at: number; add?: string; drop?: string }[] = [];
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      if (/\bdeleted_at\s+timestamptz/i.test(sql.slice(open, closingParen(sql, open)))) {
        events.push({ at: m.index ?? 0, add: m[1]!.toLowerCase() });
      }
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)[^;]*?add\s+column\s+(?:if\s+not\s+exists\s+)?deleted_at\b/gi)) {
      events.push({ at: m.index ?? 0, add: m[1]!.toLowerCase() });
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([\w.,\s]+?)(?:\s+cascade)?\s*;/gi)) {
      for (const t of m[1]!.split(',')) events.push({ at: m.index ?? 0, drop: t.trim().replace(/^public\./i, '').toLowerCase() });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.add) tables.add(e.add);
      if (e.drop) tables.delete(e.drop);
    }
  }
  return tables;
}

const SQL_WORDS = new Set([
  'where', 'on', 'using', 'set', 'join', 'left', 'inner', 'cross', 'for', 'order', 'group', 'limit',
  'and', 'or', 'returning', 'values', 'select', 'as', 'natural', 'right', 'full', 'union', 'lateral',
  'when', 'then', 'into', 'with', 'default', 'except', 'offset', 'where', 'having',
]);

/**
 * Funkcje pomocnicze, które same odrzucają usunięty wiersz danej tabeli. Wywołanie takiej funkcji
 * liczy się jako warunek (sprawdzane w teście: każda z nich spełnia kontrakt dla swojej tabeli).
 */
const DELEGATES: Record<string, readonly string[]> = {
  jobs: ['job_is_public', 'match_job_eligible', 'campaign_job_source', 'is_job_manager', 'is_job_company_member'],
  companies: ['job_is_public', 'match_job_eligible', 'campaign_job_source'],
  applications: ['can_access_application'],
  offers: ['can_access_offer'],
  conversations: ['is_conversation_member'],
  candidate_profiles: ['match_candidate_eligible', 'ensure_candidate_profile'],
  profiles: ['match_candidate_eligible', 'company_recipient_ok'],
};

export type Pair = { fn: string; table: string };

/** Pary (funkcja SECURITY DEFINER, tabela z deleted_at) bez warunku na deleted_at. */
export function uncheckedPairs(defs: Map<string, FnDef>, tables: Set<string>): Pair[] {
  const out: Pair[] = [];
  for (const [fn, def] of [...defs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!def.securityDefiner) continue;
    for (const table of [...tables].sort()) {
      if (!tableChecked(def.body, table)) out.push({ fn, table });
    }
  }
  return out;
}

/** true = tabela nieużywana w ciele albo z warunkiem na deleted_at (bezpośrednio lub delegatem). */
export function tableChecked(rawBody: string, table: string): boolean {
  const body = stripComments(rawBody);
  const uses = [...body.matchAll(new RegExp(
    `\\b(?:from|join|update|into|delete\\s+from)\\s+(?:only\\s+)?(?:public\\.)?${table}\\b(?:\\s+(?:as\\s+)?([a-z_][a-z0-9_]*))?`,
    'gi',
  ))];
  if (uses.length === 0) return true;
  let bare = false;
  for (const u of uses) {
    const alias = u[1]?.toLowerCase();
    if (!alias || SQL_WORDS.has(alias)) {
      bare = true;
      continue;
    }
    if (new RegExp(`\\b${alias}\\.deleted_at\\b`, 'i').test(body)) return true;
  }
  if (bare && new RegExp(`(?<![\\w.])deleted_at\\b|\\b(?:public\\.)?${table}\\.deleted_at\\b`, 'i').test(body)) return true;
  return (DELEGATES[table] ?? []).some((h) => new RegExp(`\\bpublic\\.${h}\\s*\\(`, 'i').test(body));
}

/**
 * Wyjątki: funkcja świadomie nie pomija usuniętego wiersza. Klucz `funkcja:tabela`.
 * Kategorie uzasadnień:
 *   ERASE    — usunięcie konta/retencja/GC: musi objąć także wiersze usunięte logicznie;
 *   GUARD    — trigger/blokada: pominięcie usuniętego wiersza osłabiłoby ochronę (fail-safe);
 *   WRITE    — zapis na usuniętym wierszu odrzuca trg_soft_delete_contract (0189) każdą ścieżką;
 *   NEW      — dotyczy wiersza NEW/tworzonego w tej samej transakcji (nie może być usunięty);
 *   SESSION  — dotyczy profilu z sesji (auth.uid()); sesja usuniętego profilu jest odrzucana
 *              (src/lib/auth/session.ts: `deleted_at IS NULL`), a is_admin (0185) i
 *              current_profile_role (0978) odrzucają go także w bazie;
 *   FORMAT   — tylko formatowanie/metadane znanego już identyfikatora (nazwa, język), bez decyzji
 *              o dostępie;
 *   ADMIN    — odczyt dla administratora albo operatora (dziennik, eksport, moderacja, metryki).
 *   EXPORT   — eksport własnych danych;
 *   MATCH    — potok dopasowań (kwalifikacja pary przy zapisie);
 *   MAINT    — utrzymanie/synchronizacja bez ujawniania danych.
 */
const ERASE = 'ERASE: usunięcie konta, retencja albo sprzątanie obejmuje także wiersze usunięte logicznie';
const GUARD = 'GUARD: strażnik/blokada — pominięcie usuniętego wiersza osłabiłoby ochronę';
const WRITE = 'WRITE: zapis na usuniętym wierszu odrzuca trg_soft_delete_contract (0189), stan sprawdza też can_access_*/polityka odczytu';
const NEW = 'NEW: wiersz tworzony albo NEW triggera w tej samej transakcji';
const SESSION = 'SESSION: profil z sesji; sesja usuniętego profilu jest odrzucana (session.ts), rolę odrzuca current_profile_role (0978)';
const FORMAT = 'FORMAT: formatowanie danych identyfikatora już zweryfikowanego przez wywołującego';
const ADMIN = 'ADMIN: odczyt administratora/operatora, który musi widzieć także wiersze usunięte';
const EXPORT = 'EXPORT: eksport własnych danych musi być kompletny (także wiersze usunięte logicznie)';
const MATCH = 'MATCH: wejście/kolejka przeliczenia dopasowań; kwalifikację pary (także deleted_at) rozstrzyga match_pair_eligible przy zapisie (0147)';
const MAINT = 'MAINT: zadanie utrzymaniowe/synchronizacja bez ujawniania danych; usunięty wiersz nie jest publiczny (job_is_public)';

export const EXCEPTIONS: Record<string, string> = {
  'auth.record_signup_receipts:profiles': `${NEW} — profil tworzony w tej samej transakcji rejestracji`,
  'public.admin_export_breach_incident:profiles': `${ADMIN} — nazwa autora wpisu rejestru naruszeń`,
  'public.admin_set_candidate_min_age:candidate_profiles': `${ADMIN} — ukrycie profili po zmianie progu obejmuje każdy wiersz`,
  'public.apply_erasure_tombstones:profiles': `${ERASE} — ponowne usunięcie po odtworzeniu kopii`,
  'public.attest_candidate_age:profiles': `${SESSION} — język własnego konta`,
  'public.claim_storage_deletions:files': `${ERASE} — kolejka usuwania obiektów w buckecie`,
  'public.conversation_candidate:applications': `${GUARD} — strona kandydata rozmowy (blokady firm #97, dostęp do rozmowy); usunięcie rozmowy sprawdza is_conversation_member`,
  'public.conversation_candidate:offers': `${GUARD} — strona kandydata rozmowy (blokady firm #97, dostęp do rozmowy); usunięcie rozmowy sprawdza is_conversation_member`,
  'public.create_company_with_owner:companies': `${NEW} — firma tworzona w tej transakcji`,
  'public.create_first_company:companies': `${NEW} — firma tworzona w tej transakcji`,
  'public.duplicate_job_as_draft:companies': `${MAINT} — status/blokada firmy źródłowej; szkic nie jest publiczny`,
  'public.email_unsubscribe:profiles': `${SESSION} — wypisanie z tokenu jest zawsze dozwolone (tylko zmniejsza wysyłkę)`,
  'public.email_unsubscribe_all:profiles': `${SESSION} — wypisanie z tokenu jest zawsze dozwolone (tylko zmniejsza wysyłkę)`,
  'public.enforce_application_integrity:jobs': `${NEW} — company_id z oferty dla NEW; publiczność oferty (deleted_at) sprawdza apply_to_job przez job_is_public`,
  'public.enforce_offer_integrity:companies': `${GUARD} — integralność NEW propozycji; usuniętą ofertę/firmę odrzuca send_offer (0978)`,
  'public.enforce_offer_integrity:jobs': `${GUARD} — integralność NEW propozycji; usuniętą ofertę/firmę odrzuca send_offer (0978)`,
  'public.erase_candidate_subject:applications': `${ERASE} — usunięcie konta kandydata`,
  'public.erase_candidate_subject:conversations': `${ERASE} — usunięcie konta kandydata`,
  'public.erase_candidate_subject:files': `${ERASE} — usunięcie konta kandydata`,
  'public.erase_candidate_subject:messages': `${ERASE} — usunięcie konta kandydata`,
  'public.erase_candidate_subject:offers': `${ERASE} — usunięcie konta kandydata`,
  'public.erase_candidate_subject:profiles': `${ERASE} — usunięcie konta kandydata`,
  'public.erase_employer_subject:files': `${ERASE} — usunięcie konta pracodawcy`,
  'public.erase_employer_subject:profiles': `${ERASE} — usunięcie konta pracodawcy`,
  'public.expire_due_jobs:jobs': `${MAINT} — zmiana active → expired po terminie`,
  'public.export_my_employer_data:companies': `${EXPORT} — nazwy firm członkostw i zaproszeń`,
  'public.export_my_employer_data:employer_profiles': `${EXPORT} — własny profil pracodawcy`,
  'public.finish_onboarding:profiles': `${SESSION} — własny profil kandydata; profil kandydata sprawdza ensure_candidate_profile`,
  'public.get_company_moderation_decisions:jobs': `${ADMIN} — firma widzi decyzje także o ofercie usuniętej przez moderację (odwołanie)`,
  'public.get_company_team:profiles': `${ADMIN} — owner/admin firmy zarządza każdym członkostwem, także konta w trakcie usuwania`,
  'public.get_conversation_company_name:companies': `${FORMAT} — nazwa firmy rozmowy (rozmowa sprawdzana is_conversation_member)`,
  'public.get_conversation_summaries:companies': `${FORMAT} — nazwa firmy rozmowy (rozmowa sprawdzana is_conversation_member)`,
  'public.get_conversation_template_context:companies': `${FORMAT} — zmienne szablonu; rozmowa sprawdzana deleted_at i is_conversation_member`,
  'public.get_conversation_template_context:jobs': `${FORMAT} — zmienne szablonu; rozmowa sprawdzana deleted_at i is_conversation_member`,
  'public.get_conversation_template_context:profiles': `${FORMAT} — zmienne szablonu; rozmowa sprawdzana deleted_at i is_conversation_member`,
  'public.get_job_company_block:profiles': `${SESSION} — rola własnego konta; oferta przez job_is_public`,
  'public.get_my_company_blocks:companies': `${GUARD} — kandydat widzi i może zdjąć każdą swoją blokadę`,
  'public.get_or_create_conversation:jobs': `${FORMAT} — firma i oferta relacji; dostęp i usunięcie aplikacji/propozycji rozstrzyga can_access_* (0978)`,
  'public.guard_conversation_guest_application:applications': `${GUARD} — rozmowa do aplikacji gościa`,
  'public.guard_message_candidate_block:conversations': `${GUARD} — blokada firmy przez kandydata (#97)`,
  'public.guard_offer_candidate_block:jobs': `${GUARD} — blokada firmy przez kandydata (#97)`,
  'public.handle_new_user:profiles': `${NEW} — profil tworzony dla nowego konta`,
  'public.insert_candidate_age_attestation:profiles': `${SESSION} — deklaracja wieku własnego albo właśnie tworzonego konta`,
  'public.job_duplications_copy_apply_channel:jobs': `${NEW} — kopia do szkicu NEW; źródło sprawdza duplicate_job_as_draft`,
  'public.job_duplications_copy_costs:jobs': `${NEW} — kopia do szkicu NEW; źródło sprawdza duplicate_job_as_draft`,
  'public.job_translation_source_fields:jobs': `${MAINT} — pola źródła tłumaczenia; sync_job_translation_source ukrywa/usuwa niepubliczne`,
  'public.job_trust_content:jobs': `${MAINT} — migawka treści do przeglądu zaufania`,
  'public.location_aliases_relink_jobs:jobs': `${MAINT} — dowiązanie miejscowości po nowym aliasie`,
  'public.match_candidate_input:candidate_profiles': `${MATCH} — dane wejściowe scoreMatch`,
  'public.match_enqueue:candidate_profiles': `${MATCH} — blokada wiersza podmiotu przed kolejką (0149)`,
  'public.match_enqueue:jobs': `${MATCH} — blokada wiersza podmiotu przed kolejką (0149)`,
  'public.message_attachment_delete_file:files': `${ERASE} — usunięcie pliku po usunięciu załącznika`,
  'public.moderation_effect_check:companies': `${ADMIN} — kontrola skutku decyzji moderacyjnej`,
  'public.moderation_effect_check:jobs': `${ADMIN} — kontrola skutku decyzji moderacyjnej`,
  'public.moderation_restore_core:companies': `${ADMIN} — cofnięcie decyzji moderacyjnej`,
  'public.moderation_restore_core:jobs': `${ADMIN} — cofnięcie decyzji moderacyjnej`,
  'public.ops_metrics:jobs': `${ADMIN} — liczniki operacyjne`,
  'public.process_saved_search_alerts:companies': `${MAINT} — oferty z saved_search_matching_jobs (warunki get_public_jobs: deleted_at ofert i firm)`,
  'public.process_saved_search_alerts:jobs': `${MAINT} — oferty z saved_search_matching_jobs (warunki get_public_jobs: deleted_at ofert i firm)`,
  'public.profile_full_name:profiles': `${FORMAT} — imię i nazwisko do treści powiadomienia`,
  'public.publish_job:companies': `${MAINT} — oferta sprawdzana deleted_at; oferta usuniętej firmy nie jest publiczna (job_is_public)`,
  'public.record_signup_consents:profiles': `${NEW} — profil tworzony w tej samej transakcji rejestracji`,
  'public.report_conversation_content:companies': `${FORMAT} — dowód zgłoszenia; rozmowa sprawdzana deleted_at`,
  'public.report_conversation_content:jobs': `${FORMAT} — dowód zgłoszenia; rozmowa sprawdzana deleted_at`,
  'public.resolve_recipient_locale:profiles': `${FORMAT} — język odbiorcy (Invariant #1); uprawnienie odbiorcy sprawdza kolejka`,
  'public.respond_to_offer:jobs': `${FORMAT} — tytuł i firma do powiadomienia`,
  'public.respond_to_offer:offers': `${WRITE} — odpowiedź na usuniętą propozycję → NOT_FOUND`,
  'public.retention_purge_batch:applications': `${ERASE} — retencja`,
  'public.retention_purge_batch:candidate_profiles': `${ERASE} — retencja`,
  'public.retention_purge_batch:conversations': `${ERASE} — retencja`,
  'public.retention_purge_batch:messages': `${ERASE} — retencja`,
  'public.send_message:companies': `${FORMAT} — nazwa firmy nadawcy; rozmowę sprawdza is_conversation_member (0978)`,
  'public.send_message:messages': `${WRITE} — nowa wiadomość do usuniętej rozmowy → NOT_FOUND; ponowienie zwraca istniejący identyfikator`,
  'public.set_company_block:profiles': `${SESSION} — rola własnego konta`,
  'public.set_job_status:companies': `${MAINT} — oferta sprawdzana deleted_at; oferta usuniętej firmy nie jest publiczna (job_is_public)`,
  'public.stage_message_attachment:files': `${NEW} — wiersz pliku tworzony w tej transakcji`,
  'public.storage_gc_page:files': `${ERASE} — GC obiektów bez wiersza files`,
  'public.submit_moderation_appeal:companies': `${FORMAT} — nazwa firmy do powiadomienia`,
  'public.touch_profile_activity:profiles': `${SESSION} — znacznik aktywności z nowej sesji`,
  'public.transition_application:applications': `${WRITE} — zmiana statusu usuniętej aplikacji → NOT_FOUND`,
  'public.transition_application:companies': `${FORMAT} — nazwa firmy do powiadomienia/e-maila`,
  'public.trg_job_translation_sync:jobs': `${MAINT} — kolejkowanie synchronizacji tłumaczenia`,
  'public.trg_match_enqueue_candidate_relation:candidate_profiles': `${MATCH} — kolejkowanie przeliczenia`,
  'public.trg_match_enqueue_job_relation:jobs': `${MATCH} — kolejkowanie przeliczenia`,
  'public.update_published_job:companies': `${MAINT} — oferta sprawdzana deleted_at; oferta usuniętej firmy nie jest publiczna (job_is_public)`,
};

describe('soft-delete: funkcje SECURITY DEFINER (#1111)', () => {
  const files = migrationFiles();
  const defs = latestFunctions(files);
  const tables = softDeleteTables(files);

  it('zna wszystkie tabele z kolumną deleted_at', () => {
    for (const t of ['profiles', 'candidate_profiles', 'companies', 'employer_profiles', 'jobs',
      'applications', 'offers', 'conversations', 'messages', 'files']) {
      expect(tables.has(t), t).toBe(true);
    }
    // 0177 usunęła schemat billingu (subscriptions miała deleted_at).
    expect(tables.has('subscriptions')).toBe(false);
  });

  it('funkcje pomocnicze (DELEGATES) same sprawdzają deleted_at swojej tabeli', () => {
    for (const [table, helpers] of Object.entries(DELEGATES)) {
      for (const h of helpers) {
        const def = defs.get(`public.${h}`);
        expect(def, h).toBeDefined();
        const body = stripComments(def!.body);
        expect(/deleted_at/i.test(body), `${h} → ${table}`).toBe(true);
      }
    }
  });

  it('każda para funkcja–tabela ma warunek deleted_at albo uzasadniony wyjątek', () => {
    const missing = uncheckedPairs(defs, tables)
      .map((p) => `${p.fn}:${p.table}`)
      .filter((k) => !(k in EXCEPTIONS));
    expect(missing).toEqual([]);
  });

  it('lista wyjątków jest aktualna (bez wpisów, które już spełniają kontrakt)', () => {
    const unchecked = new Set(uncheckedPairs(defs, tables).map((p) => `${p.fn}:${p.table}`));
    expect(Object.keys(EXCEPTIONS).filter((k) => !unchecked.has(k))).toEqual([]);
    for (const reason of Object.values(EXCEPTIONS)) expect(reason.length).toBeGreaterThan(20);
  });

  it('funkcje poprawione w 0978 spełniają kontrakt bez wyjątków', () => {
    const fixed = ['current_profile_role', 'can_access_application', 'can_access_offer',
      'is_job_company_member', 'is_job_manager', 'is_conversation_member', 'conversation_created_by_me',
      'owns_candidate_profile', 'email_recipient_authorized', 'ensure_candidate_profile'];
    for (const fn of fixed) {
      const def = defs.get(`public.${fn}`)!;
      expect(def.file, fn).toMatch(/_soft_delete_definer_review\.sql$/);
      for (const t of tables) expect(tableChecked(def.body, t), `${fn}:${t}`).toBe(true);
    }
    for (const [fn, t] of [['apply_to_job', 'applications'], ['send_offer', 'applications'],
      ['send_offer', 'jobs'], ['send_offer', 'companies'], ['send_offer', 'candidate_profiles']] as const) {
      expect(tableChecked(defs.get(`public.${fn}`)!.body, t), `${fn}:${t}`).toBe(true);
    }
  });

  it('kontrola ujemna: definicje sprzed 0978 i syntetyczna funkcja są wykrywane', () => {
    const withoutFix = files.filter((f) => !f.name.endsWith('_soft_delete_definer_review.sql'));
    const old = latestFunctions(withoutFix);
    expect(tableChecked(old.get('public.current_profile_role')!.body, 'profiles')).toBe(false);
    // is_admin sprawdza deleted_at od 0185 — także bez 0978.
    expect(tableChecked(old.get('public.is_admin')!.body, 'profiles')).toBe(true);
    expect(tableChecked(old.get('public.is_job_manager')!.body, 'jobs')).toBe(false);
    expect(tableChecked(old.get('public.can_access_application')!.body, 'applications')).toBe(false);
    expect(tableChecked(old.get('public.email_recipient_authorized')!.body, 'messages')).toBe(false);
    const oldMissing = new Set(uncheckedPairs(old, tables).map((p) => `${p.fn}:${p.table}`));
    expect(oldMissing.has('public.is_conversation_member:conversations')).toBe(true);

    const synthetic = `create or replace function public.leak(p uuid) returns text
      language sql security definer set search_path = public, pg_temp as $$
        select m.body from public.messages m where m.id = p;
      $$;`;
    const defsSynthetic = latestFunctions([...files, { name: '9999_leak.sql', sql: synthetic }]);
    expect(uncheckedPairs(defsSynthetic, tables).map((p) => `${p.fn}:${p.table}`)).toContain('public.leak:messages');
    // Warunek na innym aliasie nie zalicza tabeli.
    expect(tableChecked('select m.body from public.messages m join public.conversations c on c.id = m.conversation_id where c.deleted_at is null', 'messages')).toBe(false);
    // drop function usuwa definicję (brak fałszywego „najnowszego” ciała).
    const dropped = latestFunctions([{ name: '0001.sql', sql: synthetic }, { name: '0002.sql', sql: 'drop function public.leak(uuid);' }]);
    expect(dropped.has('public.leak')).toBe(false);
  });
});

