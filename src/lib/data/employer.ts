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

import { cache } from 'react';

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

/**
 * Statusy z `application_status_history` traktowane jako „osiągnięto etap rozmowy".
 * Zawiera `hired` oraz etapy ofertowe (następują PO rozmowie), więc licznik rozmów jest
 * kumulatywny i gwarantuje monotoniczność lejka: hired ⊆ interviews ⊆ applications
 * (żadna inwersja typu hired > interviews).
 */
const FUNNEL_INTERVIEW_STAGES = [
  'interview',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'hired',
] as const;

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

/**
 * Kontekst pracodawcy (sesja + aktywna firma) rozwiązywany RAZ na żądanie.
 * `cache()` (React) memoizuje wynik per-request — wołany przez wszystkie loadery panelu
 * (~5×/żądanie) wykonuje `auth.getUser()` + odczyt `company_members` tylko jeden raz.
 */
const loadContext = cache(async (): Promise<EmployerContext | null> => {
  const { createServerClient } = await import('@/lib/supabase/server');
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // AKTYWNA firma z kontekstu (cookie-aware, zwalidowana — FUN-07), nie „pierwsze członkostwo".
  const { getActiveCompany } = await import('@/lib/company-context');
  const ctx = await getActiveCompany(supabase, user.id);
  if (!ctx.activeId) return null;

  return { supabase, userId: user.id, companyId: ctx.activeId, companyStatus: ctx.activeStatus };
});

/**
 * Dane do chrome panelu pracodawcy (FUN-07/FUN-13): lista firm użytkownika + aktywna firma +
 * dane użytkownika. Bez env → null (layout użyje fallbacku demo).
 */
export async function getEmployerShellData(): Promise<{
  companies: { id: string; name: string; role: string }[];
  activeId: string | null;
  activeName: string;
  activeRole: string;
  userName: string;
} | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { getActiveCompany } = await import('@/lib/company-context');
    const ctx = await getActiveCompany(supabase, user.id);

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();
    const p = asRecord(profileRow);
    const userName = [asString(p['first_name']), asString(p['last_name'])]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');

    return {
      companies: ctx.companies.map((c) => ({ id: c.id, name: c.name, role: c.role })),
      activeId: ctx.activeId,
      activeName: ctx.activeName,
      activeRole: ctx.activeRole,
      userName,
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerShellData' });
    return null;
  }
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

/** Uprawnienia planu aktywnej firmy (P1-01): limit aktywnych ofert + dostęp do bazy kandydatów. */
export interface CompanyEntitlements {
  plan: string;
  maxActiveJobs: number;
  candidateAccess: boolean;
  activeJobsUsed: number;
}

/**
 * Realne uprawnienia planu aktywnej firmy (get_company_entitlements pod RLS). Zwraca `null` w
 * trybie demo / bez kontekstu — UI używa wtedy statycznego fallbacku (P1-09).
 */
export async function getCompanyEntitlements(): Promise<CompanyEntitlements | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const ctx = await loadContext();
    if (!ctx) return null;
    const { supabase, companyId } = ctx;
    const { data, error } = await supabase.rpc('get_company_entitlements', {
      p_company_id: companyId,
    });
    if (error) throw error;
    const row = asRecord(Array.isArray(data) ? data[0] : data);
    if (!row['plan']) return null;
    return {
      plan: asString(row['plan'], 'free'),
      maxActiveJobs: asNumber(row['max_active_jobs']),
      candidateAccess: row['candidate_access'] === true,
      activeJobsUsed: asNumber(row['active_jobs_used']),
    };
  } catch (error) {
    captureError(error, { area: 'employer.getCompanyEntitlements' });
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * P1-04: wznowienie/edycja szkicu oferty (kreator startuje z zapisanych danych)
 * ------------------------------------------------------------------------- */

/** Wartości szkicu oferty w kształcie pól kreatora (JobWizard). Puste = nieuzupełnione. */
export interface JobDraftValues {
  title: string;
  category: string;
  occupation: string;
  contractType: string;
  workingHours: string;
  shifts: string;
  startImmediately: boolean;
  startDate: string;
  city: string;
  region: string;
  address: string;
  remote: boolean;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  salaryPeriod: string;
  description: string;
  responsibilities: string[];
  requirementsMandatory: string[];
  mandatorySkills: string[];
  minExperienceYears: string;
  requirementsOptional: string[];
  skills: string[];
  languages: { language: string; level: string }[];
  requiredCertificates: string[];
  requiresDrivingLicense: boolean;
  noLanguageRequired: boolean;
  conditions: string[];
  benefits: string[];
  accommodation: boolean;
  transport: boolean;
  companyDescription: string;
  contactEmail: string;
}

/** Wynik wczytania szkicu: jawnie rozdziela „brak/obcy", „nie-szkic" i błąd odczytu. */
export type JobDraftLoad =
  | { status: 'ok'; jobId: string; jobStatus: string; values: JobDraftValues }
  | { status: 'not-found' }
  | { status: 'not-draft'; jobStatus: string }
  | { status: 'error' };

function numToText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Wczytuje szkic oferty firmy do kształtu pól kreatora (P1-04: koniec osieroconych draftów —
 * „Zapisz i wyjdź" nie gubi już pracy). Czyta POD SESJĄ (RLS: tylko oferty własnej firmy), więc
 * członek innej firmy dostanie `not-found`. Relacje (wymagania/umiejętności/języki/certyfikaty)
 * są wczytywane, bo kreator zapisuje je przez replace-all — bez nich „Dalej" by je wyczyścił
 * (ta sama pułapka co P1-07/P1-08). Błąd odczytu → 'error' (UI pokazuje retry, nie pusty kreator).
 */
export async function getJobDraft(jobId: string): Promise<JobDraftLoad> {
  if (!isSupabaseConfigured()) return { status: 'not-found' };
  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'not-found' };
    const { supabase, companyId } = ctx;

    const { data: jobRow, error: jobErr } = await supabase
      .from('jobs')
      .select(
        'id, company_id, status, title, category, occupation, contract_type, working_hours, shifts, ' +
          'start_immediately, start_date, city, region, address, remote, salary_min, salary_max, ' +
          'currency, salary_period, min_experience_years, requires_driving_license, ' +
          'no_language_required, accommodation, transport, contact_email, default_locale',
      )
      .eq('id', jobId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (jobErr) return { status: 'error' };
    const job = asRecord(jobRow);
    if (!asString(job['id'])) return { status: 'not-found' };

    const jobStatus = asString(job['status']);
    if (jobStatus !== 'draft') return { status: 'not-draft', jobStatus };

    const locale = asString(job['default_locale'], 'pl');
    const [translation, requirements, skills, languages, certificates] = await Promise.all([
      supabase
        .from('job_translations')
        .select('description, responsibilities, conditions, benefits, company_description')
        .eq('job_id', jobId)
        .eq('locale', locale)
        .maybeSingle(),
      supabase.from('job_requirements').select('kind, content, position').eq('job_id', jobId),
      supabase.from('job_skills').select('skill_label, is_mandatory').eq('job_id', jobId),
      supabase.from('job_languages').select('language_label, level').eq('job_id', jobId),
      supabase.from('job_certificates').select('certificate_label').eq('job_id', jobId),
    ]);
    // Każdy błąd relacji → 'error': kreator startujący z pustych relacji SKASOWAŁBY je przy zapisie.
    if (
      translation.error ||
      requirements.error ||
      skills.error ||
      languages.error ||
      certificates.error
    ) {
      return { status: 'error' };
    }

    const tr = asRecord(translation.data);
    const reqRows = Array.isArray(requirements.data) ? requirements.data : [];
    const byKind = (kind: string): string[] =>
      reqRows
        .map((r) => asRecord(r))
        .filter((r) => asString(r['kind']) === kind)
        .sort((a, b) => asNumber(a['position']) - asNumber(b['position']))
        .map((r) => asString(r['content']))
        .filter(Boolean);
    const skillRows = (Array.isArray(skills.data) ? skills.data : []).map((r) => asRecord(r));

    return {
      status: 'ok',
      jobId,
      jobStatus,
      values: {
        title: asString(job['title']),
        category: asString(job['category']),
        occupation: asString(job['occupation']),
        contractType: asString(job['contract_type']),
        workingHours: asString(job['working_hours']),
        shifts: asString(job['shifts']),
        startImmediately: job['start_immediately'] === true,
        startDate: asString(job['start_date']),
        city: asString(job['city']),
        region: asString(job['region']),
        address: asString(job['address']),
        remote: job['remote'] === true,
        salaryMin: numToText(job['salary_min']),
        salaryMax: numToText(job['salary_max']),
        currency: asString(job['currency'], 'EUR'),
        salaryPeriod: asString(job['salary_period'], 'month'),
        description: asString(tr['description']),
        responsibilities: asStringArray(tr['responsibilities']),
        requirementsMandatory: byKind('mandatory'),
        mandatorySkills: skillRows
          .filter((r) => r['is_mandatory'] === true)
          .map((r) => asString(r['skill_label']))
          .filter(Boolean),
        minExperienceYears: numToText(job['min_experience_years']),
        requirementsOptional: byKind('optional'),
        skills: skillRows
          .filter((r) => r['is_mandatory'] !== true)
          .map((r) => asString(r['skill_label']))
          .filter(Boolean),
        languages: (Array.isArray(languages.data) ? languages.data : [])
          .map((r) => asRecord(r))
          .map((r) => ({
            language: asString(r['language_label']),
            level: asString(r['level'], 'basic'),
          }))
          .filter((l) => l.language !== ''),
        requiredCertificates: (Array.isArray(certificates.data) ? certificates.data : [])
          .map((r) => asString(asRecord(r)['certificate_label']))
          .filter(Boolean),
        requiresDrivingLicense: job['requires_driving_license'] === true,
        noLanguageRequired: job['no_language_required'] === true,
        conditions: asStringArray(tr['conditions']),
        benefits: asStringArray(tr['benefits']),
        accommodation: job['accommodation'] === true,
        transport: job['transport'] === true,
        companyDescription: asString(tr['company_description']),
        contactEmail: asString(job['contact_email']),
      },
    };
  } catch (error) {
    captureError(error, { area: 'employer.getJobDraft' });
    return { status: 'error' };
  }
}

/** Jawny stan odczytu dla ekranu ofert — błąd bazy nie może udawać pustej listy. */
export type CompanyJobsLoad =
  | { status: 'ok'; jobs: EmployerJob[]; hasNext: boolean }
  | { status: 'error' };

/** Lista ofert firmy z liczbą nowych aplikacji i dopasowań na ofertę. */
export async function getCompanyJobsLoad(page = 1): Promise<CompanyJobsLoad> {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const start = (safePage - 1) * 12;
  if (!isSupabaseConfigured()) return { status: 'ok', jobs: DEMO_JOBS.slice(start, start + 12), hasNext: DEMO_JOBS.length > start + 12 };

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', jobs: [], hasNext: false };
    const { supabase, companyId } = ctx;

    const { data: jobsData, error: jobsError } = await supabase
      .from('jobs')
      .select('id, title, city, status')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + 12);
    if (jobsError) throw jobsError;

    const rows = asRows(jobsData);
    const hasNext = rows.length > 12;
    const jobs = rows.slice(0, 12);
    const jobIds = jobs.map((r) => asString(r['id'])).filter((id) => id.length > 0);
    if (jobIds.length === 0) return { status: 'ok', jobs: [], hasNext: false };

    // Exact head counts avoid Supabase's row limit and transfer no application/match rows.
    const counts = await Promise.all(jobIds.map(async (id) => {
      const [applications, matches] = await Promise.all([
        supabase.from('applications').select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).eq('job_id', id).eq('status', 'submitted').is('deleted_at', null),
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('job_id', id),
      ]);
      if (applications.error) throw applications.error;
      if (matches.error) throw matches.error;
      return { id, newApplications: applications.count ?? 0, matched: matches.count ?? 0 };
    }));
    const countsByJob = new Map(counts.map((row) => [row.id, row]));

    return { status: 'ok', hasNext, jobs: jobs.map((r) => {
      const id = asString(r['id']);
      return {
        id,
        title: asString(r['title']),
        city: asString(r['city']),
        status: asString(r['status'], 'draft'),
        newApplications: countsByJob.get(id)?.newApplications ?? 0,
        matched: countsByJob.get(id)?.matched ?? 0,
      };
    }) };
  } catch (error) {
    captureError(error, { area: 'employer.getCompanyJobs' });
    return { status: 'error' };
  }
}

/** Starszy kontrakt dashboardu; ekran listy korzysta z jawnego stanu powyżej. */
export async function getCompanyJobs(): Promise<EmployerJob[]> {
  const result = await getCompanyJobsLoad();
  return result.status === 'ok' ? result.jobs : [];
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

/** Pełna lista aplikacji w małych stronach; osobny wynik błędu chroni przed fałszywym pustym stanem. */
export type EmployerApplicationsLoad =
  | { status: 'ok'; applications: EmployerApplication[]; hasMore: boolean; isDemo: boolean }
  | { status: 'error' };

export const EMPLOYER_APPLICATIONS_PAGE_SIZE = 12;

export async function getEmployerApplicationsPage(page: number): Promise<EmployerApplicationsLoad> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return { status: 'error' };

  if (!isSupabaseConfigured()) {
    return { status: 'ok', applications: page === 1 ? DEMO_APPLICATIONS : [], hasMore: false, isDemo: true };
  }

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', applications: [], hasMore: false, isDemo: false };
    const { supabase, companyId } = ctx;
    const start = (page - 1) * EMPLOYER_APPLICATIONS_PAGE_SIZE;
    const { data, error } = await supabase
      .from('applications')
      .select('id, status, profiles(first_name, last_name), jobs(title)')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + EMPLOYER_APPLICATIONS_PAGE_SIZE);
    if (error) throw error;

    const rows = asRows(data);
    return {
      status: 'ok',
      isDemo: false,
      hasMore: rows.length > EMPLOYER_APPLICATIONS_PAGE_SIZE,
      applications: rows.slice(0, EMPLOYER_APPLICATIONS_PAGE_SIZE).map((row) => {
        const profile = asEmbeddedRecord(row['profiles']);
        const job = asEmbeddedRecord(row['jobs']);
        return {
          id: asString(row['id']),
          candidateName: fullName(profile['first_name'], profile['last_name']),
          jobTitle: asString(job['title']),
          status: asString(row['status'], 'submitted'),
        };
      }),
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerApplicationsPage' });
    return { status: 'error' };
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

    // Wyświetlenia = suma views_count ofert firmy; aplikacje = wszystkie aplikacje firmy.
    const [{ data: viewsData, error: viewsError }, { data: appData, error: appError }] =
      await Promise.all([
        supabase.from('jobs').select('views_count').eq('company_id', companyId).is('deleted_at', null),
        supabase.from('applications').select('id').eq('company_id', companyId).is('deleted_at', null),
      ]);
    if (viewsError) throw viewsError;
    if (appError) throw appError;

    const views = asRows(viewsData).reduce((sum, r) => sum + asNumber(r['views_count']), 0);
    const appIds = asRows(appData)
      .map((r) => asString(r['id']))
      .filter((id) => id.length > 0);

    // Rozmowy i zatrudnieni liczone KUMULATYWNIE z historii statusów (kandydat, który
    // KIEDYKOLWIEK osiągnął etap) — nie po bieżącym statusie — co eliminuje inwersję lejka.
    let interviews = 0;
    let hired = 0;
    if (appIds.length > 0) {
      const { data: historyData, error: historyError } = await supabase
        .from('application_status_history')
        .select('application_id, to_status')
        .in('application_id', appIds)
        .in('to_status', [...FUNNEL_INTERVIEW_STAGES]);
      if (historyError) throw historyError;

      const interviewSet = new Set<string>();
      const hiredSet = new Set<string>();
      for (const r of asRows(historyData)) {
        const appId = asString(r['application_id']);
        if (!appId) continue;
        interviewSet.add(appId);
        if (asString(r['to_status']) === 'hired') hiredSet.add(appId);
      }
      interviews = interviewSet.size;
      hired = hiredSet.size;
    }

    return { views, applications: appIds.length, interviews, hired };
  } catch (error) {
    captureError(error, { area: 'employer.getFunnelStats' });
    return EMPTY_FUNNEL;
  }
}
