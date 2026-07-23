/**
 * Warstwa danych panelu pracodawcy — Pracuj.be (Etap 4).
 *
 * Strategia (spójna z `@/lib/jobs`): gdy `isSupabaseConfigured()` — dane czytane są z bazy
 * pod SESJĄ zalogowanego użytkownika (RLS), przez `createServerClient` (NIGDY service-role).
 * Bez konfiguracji Supabase (build/preview bez env) zwracamy te same struktury z danymi DEMO,
 * dzięki czemu panel renderuje się bez zmiennych środowiskowych (Invariant: brak degradacji
 * skonfigurowanej bazy do danych demonstracyjnych — w trybie DB zwracamy dane realne lub puste).
 *
 * „Aktywna firma" wyznaczana jest z `company_members` (pierwsze aktywne członkostwo) — panel
 * pokazuje dane wyłącznie tej firmy (RLS pilnuje izolacji firma A / firma B).
 *
 * Klient Supabase importowany jest LENIWIE (dynamic import) — moduł nie ciągnie `next/headers`
 * do bundla trybu DEMO.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/* ---------------------------------------------------------------------------
 * Kontrakt (typy zwracane do UI)
 * ------------------------------------------------------------------------- */

export interface EmployerOverview {
  activeOffersCount: number;
  newApplicationsCount: number;
  matchedCandidatesCount: number;
  messagesToAnswerCount: number;
}

export interface EmployerJob {
  id: string;
  title: string;
  city: string;
  /** Surowy `job_status` (draft/active/paused/closed/expired) — mapowany w StatusPill. */
  status: string;
  newApplications: number;
  matched: number;
}

export interface EmployerApplication {
  id: string;
  candidateName: string;
  jobTitle: string;
  /** Surowy `application_status` — mapowany w StatusPill. */
  status: string;
}

export interface EmployerMatchedCandidate {
  candidateId: string;
  /** Oferta o najwyższym dopasowaniu do kandydata (cel wysyłki propozycji). */
  jobId: string;
  /** Imię i nazwisko, o ile widoczne przez RLS; inaczej pusty string (UI podstawia etykietę). */
  name: string;
  role: string;
  city: string;
  /** Dopasowanie w procentach (0–100). */
  match: number;
}

export interface FunnelStats {
  views: number;
  applications: number;
  interviews: number;
  hired: number;
}

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez env) — przeniesione z employer/page.tsx
 * ------------------------------------------------------------------------- */

const DEMO_OVERVIEW: EmployerOverview = {
  activeOffersCount: 8,
  newApplicationsCount: 42,
  matchedCandidatesCount: 26,
  messagesToAnswerCount: 5,
};

/** Delty tygodniowe do podpisów StatCard — wyłącznie w trybie DEMO (brak historii w DB path). */
export const DEMO_OVERVIEW_DELTAS = {
  activeOffers: 2,
  newApplications: 18,
  matched: 7,
  urgent: 2,
} as const;

const DEMO_JOBS: EmployerJob[] = [
  { id: '12345', title: 'Operator wózka widłowego', city: 'Liège', status: 'active', newApplications: 12, matched: 6 },
  { id: '12344', title: 'Pracownik magazynu', city: 'Antwerpia', status: 'active', newApplications: 8, matched: 4 },
  { id: '12343', title: 'Elektryk przemysłowy', city: 'Charleroi', status: 'active', newApplications: 5, matched: 3 },
  { id: '12342', title: 'Produkcja – operator maszyn', city: 'Genk', status: 'active', newApplications: 7, matched: 4 },
  { id: '12341', title: 'Specjalista ds. logistyki', city: 'Bruksela', status: 'active', newApplications: 3, matched: 2 },
];

const DEMO_APPLICATIONS: EmployerApplication[] = [
  { id: 'demo-app-1', candidateName: 'Piotr Nowak', jobTitle: 'Elektryk przemysłowy', status: 'submitted' },
  { id: 'demo-app-2', candidateName: 'Katarzyna Zielińska', jobTitle: 'Operator wózka widłowego', status: 'viewed' },
  { id: 'demo-app-3', candidateName: 'Michał Wiśniewski', jobTitle: 'Pracownik magazynu', status: 'shortlisted' },
  { id: 'demo-app-4', candidateName: 'Anna Kowalczyk', jobTitle: 'Specjalista ds. logistyki', status: 'interview' },
];

const DEMO_CANDIDATES: EmployerMatchedCandidate[] = [
  { candidateId: 'demo-c-1', jobId: '12343', name: 'Piotr Nowak', role: 'Elektryk przemysłowy', city: 'Charleroi', match: 92 },
  { candidateId: 'demo-c-2', jobId: '12345', name: 'Katarzyna Zielińska', role: 'Operator wózka widłowego', city: 'Liège', match: 88 },
  { candidateId: 'demo-c-3', jobId: '12344', name: 'Michał Wiśniewski', role: 'Pracownik magazynu', city: 'Antwerpia', match: 85 },
];

const DEMO_FUNNEL: FunnelStats = { views: 4126, applications: 287, interviews: 38, hired: 6 };

const EMPTY_OVERVIEW: EmployerOverview = {
  activeOffersCount: 0,
  newApplicationsCount: 0,
  matchedCandidatesCount: 0,
  messagesToAnswerCount: 0,
};

const EMPTY_FUNNEL: FunnelStats = { views: 0, applications: 0, interviews: 0, hired: 0 };

/* ---------------------------------------------------------------------------
 * Pomocnicze parsowanie (klient Supabase jest nietypowany → dane `any`)
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/** Embed PostgREST bywa obiektem (to-one) lub tablicą — normalizujemy do pierwszego rekordu. */
function asEmbeddedRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function fullName(first: unknown, last: unknown): string {
  return `${asString(first)} ${asString(last)}`.trim();
}

/* ---------------------------------------------------------------------------
 * Kontekst pracodawcy (użytkownik + aktywna firma)
 * ------------------------------------------------------------------------- */

interface EmployerContext {
  supabase: SupabaseClient;
  userId: string;
  companyId: string;
  companyStatus: string;
}

async function loadContext(): Promise<EmployerContext | null> {
  const { createServerClient } = await import('@/lib/supabase/server');
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Pierwsze aktywne członkostwo = aktywna firma. RLS: własny wiersz company_members
  // (profile_id = auth.uid()) + odczyt firmy jako członek (companies_select_member).
  const { data, error } = await supabase
    .from('company_members')
    .select('company_id, companies(id, status)')
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw error;
  const row = asRows(data)[0];
  if (!row) return null;

  const companyId = asString(row['company_id']);
  if (!companyId) return null;
  const company = asEmbeddedRecord(row['companies']);
  const companyStatus = asString(company['status'], 'unverified');

  return { supabase, userId: user.id, companyId, companyStatus };
}

/** Identyfikatory (nie usuniętych) ofert aktywnej firmy — do zapytań o aplikacje/dopasowania. */
async function companyJobIds(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null);
  if (error) throw error;
  return asRows(data)
    .map((r) => asString(r['id']))
    .filter((id) => id.length > 0);
}

/** Wyciąga licznik z odpowiedzi `{ count, error }` zapytania z opcją `{ count: 'exact', head: true }`. */
function pickCount(res: { count: number | null; error: unknown }): number {
  if (res.error) throw res.error;
  return res.count ?? 0;
}

/* ---------------------------------------------------------------------------
 * Publiczne API panelu pracodawcy
 * ------------------------------------------------------------------------- */

/** Kafelki statystyk (aktywne oferty, nowe aplikacje, dopasowani, wiadomości do odpowiedzi). */
export async function getEmployerOverview(): Promise<EmployerOverview> {
  if (!isSupabaseConfigured()) return DEMO_OVERVIEW;

  try {
    const ctx = await loadContext();
    if (!ctx) return EMPTY_OVERVIEW;
    const { supabase, companyId, userId } = ctx;

    const jobIds = await companyJobIds(supabase, companyId);

    const [activeOffers, newApps, matched, messages] = await Promise.all([
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'active')
        .is('deleted_at', null),
      supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'submitted')
        .is('deleted_at', null),
      jobIds.length === 0
        ? Promise.resolve({ count: 0, error: null })
        : supabase.from('matches').select('id', { count: 'exact', head: true }).in('job_id', jobIds),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId)
        .eq('type', 'message_received')
        .is('read_at', null),
    ]);

    return {
      activeOffersCount: pickCount(activeOffers),
      newApplicationsCount: pickCount(newApps),
      matchedCandidatesCount: pickCount(matched),
      messagesToAnswerCount: pickCount(messages),
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerOverview' });
    return EMPTY_OVERVIEW;
  }
}

/** Lista ofert firmy z liczbą nowych aplikacji i dopasowań na ofertę. */
export async function getCompanyJobs(): Promise<EmployerJob[]> {
  if (!isSupabaseConfigured()) return DEMO_JOBS;

  try {
    const ctx = await loadContext();
    if (!ctx) return [];
    const { supabase, companyId } = ctx;

    const { data: jobsData, error: jobsError } = await supabase
      .from('jobs')
      .select('id, title, city, status')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(12);
    if (jobsError) throw jobsError;

    const jobs = asRows(jobsData);
    const jobIds = jobs.map((r) => asString(r['id'])).filter((id) => id.length > 0);
    if (jobIds.length === 0) return [];

    const [{ data: appRows, error: appError }, { data: matchRows, error: matchError }] =
      await Promise.all([
        supabase
          .from('applications')
          .select('job_id')
          .eq('company_id', companyId)
          .eq('status', 'submitted')
          .is('deleted_at', null),
        supabase.from('matches').select('job_id').in('job_id', jobIds),
      ]);
    if (appError) throw appError;
    if (matchError) throw matchError;

    const newApps = new Map<string, number>();
    for (const r of asRows(appRows)) {
      const id = asString(r['job_id']);
      newApps.set(id, (newApps.get(id) ?? 0) + 1);
    }
    const matched = new Map<string, number>();
    for (const r of asRows(matchRows)) {
      const id = asString(r['job_id']);
      matched.set(id, (matched.get(id) ?? 0) + 1);
    }

    return jobs.map((r) => {
      const id = asString(r['id']);
      return {
        id,
        title: asString(r['title']),
        city: asString(r['city']),
        status: asString(r['status'], 'draft'),
        newApplications: newApps.get(id) ?? 0,
        matched: matched.get(id) ?? 0,
      };
    });
  } catch (error) {
    captureError(error, { area: 'employer.getCompanyJobs' });
    return [];
  }
}

/** Najnowsze aplikacje na oferty firmy (do wiersza akcji zmiany statusu). */
export async function getRecentApplications(): Promise<EmployerApplication[]> {
  if (!isSupabaseConfigured()) return DEMO_APPLICATIONS;

  try {
    const ctx = await loadContext();
    if (!ctx) return [];
    const { supabase, companyId } = ctx;

    // Kandydat, który aplikował, jest widoczny dla firmy (company_can_view_candidate) — RLS
    // przepuszcza odczyt profiles(imię/nazwisko) oraz jobs(tytuł) powiązanych z aplikacją.
    const { data, error } = await supabase
      .from('applications')
      .select('id, status, profiles(first_name, last_name), jobs(title)')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .limit(6);
    if (error) throw error;

    return asRows(data).map((r) => {
      const profile = asEmbeddedRecord(r['profiles']);
      const job = asEmbeddedRecord(r['jobs']);
      return {
        id: asString(r['id']),
        candidateName: fullName(profile['first_name'], profile['last_name']),
        jobTitle: asString(job['title']),
        status: asString(r['status'], 'submitted'),
      };
    });
  } catch (error) {
    captureError(error, { area: 'employer.getRecentApplications' });
    return [];
  }
}

/** Top dopasowani kandydaci (matches × candidate_profiles). Tylko dla firmy zweryfikowanej. */
export async function getTopMatchedCandidates(): Promise<EmployerMatchedCandidate[]> {
  if (!isSupabaseConfigured()) return DEMO_CANDIDATES;

  try {
    const ctx = await loadContext();
    if (!ctx) return [];
    const { supabase, companyId, companyStatus } = ctx;

    // Dostęp do bazy dopasowanych kandydatów wymaga zweryfikowanej firmy.
    if (companyStatus !== 'verified') return [];

    const jobIds = await companyJobIds(supabase, companyId);
    if (jobIds.length === 0) return [];

    const { data: matchData, error: matchError } = await supabase
      .from('matches')
      .select('candidate_id, job_id, score')
      .in('job_id', jobIds)
      .order('score', { ascending: false })
      .limit(24);
    if (matchError) throw matchError;

    // Deduplikacja po kandydacie (zachowujemy najwyższy wynik = pierwsze wystąpienie).
    const best = new Map<string, { jobId: string; score: number }>();
    for (const r of asRows(matchData)) {
      const candidateId = asString(r['candidate_id']);
      if (!candidateId || best.has(candidateId)) continue;
      best.set(candidateId, { jobId: asString(r['job_id']), score: asNumber(r['score']) });
    }
    const candidateIds = [...best.keys()].slice(0, 5);
    if (candidateIds.length === 0) return [];

    // candidate_profiles: is_searchable=true jest publicznie czytelne; profiles(imię) tylko
    // dla powiązanych relacją kandydatów (best-effort — brak imienia → UI podstawia etykietę).
    const [{ data: cpData, error: cpError }, { data: profData, error: profError }] =
      await Promise.all([
        supabase
          .from('candidate_profiles')
          .select('profile_id, headline, city, occupations')
          .in('profile_id', candidateIds),
        supabase.from('profiles').select('id, first_name, last_name').in('id', candidateIds),
      ]);
    if (cpError) throw cpError;
    if (profError) throw profError;

    const cpMap = new Map<string, Record<string, unknown>>();
    for (const r of asRows(cpData)) cpMap.set(asString(r['profile_id']), r);
    const nameMap = new Map<string, string>();
    for (const r of asRows(profData)) {
      nameMap.set(asString(r['id']), fullName(r['first_name'], r['last_name']));
    }

    return candidateIds.map((candidateId) => {
      const entry = best.get(candidateId);
      const cp = cpMap.get(candidateId) ?? {};
      const occupations = Array.isArray(cp['occupations']) ? (cp['occupations'] as unknown[]) : [];
      const firstOccupation = asString(occupations[0]);
      return {
        candidateId,
        jobId: entry?.jobId ?? '',
        name: nameMap.get(candidateId) ?? '',
        role: asString(cp['headline']) || firstOccupation,
        city: asString(cp['city']),
        match: entry?.score ?? 0,
      };
    });
  } catch (error) {
    captureError(error, { area: 'employer.getTopMatchedCandidates' });
    return [];
  }
}

/** Lejek rekrutacyjny (30 dni): wyświetlenia, aplikacje, rozmowy, zatrudnieni. */
export async function getFunnelStats(): Promise<FunnelStats> {
  if (!isSupabaseConfigured()) return DEMO_FUNNEL;

  try {
    const ctx = await loadContext();
    if (!ctx) return EMPTY_FUNNEL;
    const { supabase, companyId } = ctx;

    // Wyświetlenia = suma views_count ofert firmy; pozostałe etapy = liczba aplikacji wg statusu.
    const [{ data: viewsData, error: viewsError }, applications, interviews, hired] =
      await Promise.all([
        supabase.from('jobs').select('views_count').eq('company_id', companyId).is('deleted_at', null),
        supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .is('deleted_at', null),
        supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('status', 'interview')
          .is('deleted_at', null),
        supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('status', 'hired')
          .is('deleted_at', null),
      ]);
    if (viewsError) throw viewsError;

    const views = asRows(viewsData).reduce((sum, r) => sum + asNumber(r['views_count']), 0);
    return {
      views,
      applications: pickCount(applications),
      interviews: pickCount(interviews),
      hired: pickCount(hired),
    };
  } catch (error) {
    captureError(error, { area: 'employer.getFunnelStats' });
    return EMPTY_FUNNEL;
  }
}
