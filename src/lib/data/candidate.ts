/**
 * Warstwa dostępu do danych panelu KANDYDATA — Pracuj.be (Etap 3).
 *
 * Strategia (spójna z `@/lib/jobs`): gdy `isSupabaseConfigured()` — dane czytane są z bazy
 * POD SESJĄ użytkownika (`createServerClient`, RLS wg `auth.uid()`); bez env — te same
 * struktury wypełnione danymi DEMO (build i UX działają bez backendu).
 *
 * Odczyt idzie WYŁĄCZNIE przez klienta z sesją (nie service-role). Publiczne dane oferty
 * (tytuł/firma/miasto) nie są dostępne kandydatowi wprost z tabel `jobs`/`companies`
 * (P1-01: anon/authenticated-niebędący-członkiem nie czyta tabel bazowych), dlatego
 * wzbogacamy je przez RPC `get_public_jobs` (bezpieczne kolumny) i łączymy po `job_id`.
 *
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do Sentry
 * i degradujemy do bezpiecznej pustej struktury (0 / []), a nie do danych DEMO — panel jest
 * noindex i per-użytkownik, więc pusty realny wynik jest prawdziwy (nie „udaje" ofert).
 */

import { cache } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { routing, type Locale } from '@/i18n/routing';
import { demoCompanies, resolveDemoJobs } from '@/lib/data/demo';
import { findLatestActiveProposal } from '@/lib/candidate-offers';

/* ---------------------------------------------------------------------------
 * Kontrakt danych panelu kandydata
 * ------------------------------------------------------------------------- */

export interface CandidateOverview {
  newJobsCount: number;
  activeApplicationsCount: number;
  unreadMessagesCount: number;
  profileCompletionPct: number;
}

export interface RecommendedJob {
  id: string;
  slug: string | null;
  title: string;
  companyName: string;
  city: string;
  /** Wynik dopasowania (%). `null` = brak policzonego matchu (fallback do najnowszych ofert). */
  match: number | null;
  saved: boolean;
}

export interface MyApplication {
  id: string;
  jobTitle: string;
  companyName: string;
  slug: string | null;
  /** Data zgłoszenia (ISO). Formatowanie do wyświetlenia robi ekran (locale). */
  date: string;
  status: string;
}

export interface LatestMessage {
  id: string;
  title: string;
  preview: string;
  /** Czas ostatniej wiadomości (ISO). Formatowanie robi ekran (locale). */
  time: string;
  unread: boolean;
}

export interface MyOffer {
  id: string;
  jobTitle: string;
  companyName: string;
  slug: string | null;
  /** Treść propozycji od pracodawcy (może być pusta w danych DEMO). */
  message: string;
  /** Data wysłania propozycji (ISO). Formatowanie do wyświetlenia robi ekran (locale). */
  date: string;
  status: string;
  expiresAt: string | null;
}

export interface CandidateProfileSummary {
  firstName: string | null;
  completionPct: number;
  checklist: {
    basicInfo: boolean;
    experience: boolean;
    education: boolean;
    skills: boolean;
    languages: boolean;
    photo: boolean;
  };
}

/** Pola zawodowe widoczne dla właściciela profilu, odczytywane pod jego sesją. */
export interface CandidatePassport {
  loadFailed: boolean;
  occupations: string[];
  city: string | null;
  radiusKm: number | null;
  experienceYears: number | null;
  availability: string | null;
  skills: string[];
  languages: string[];
  certificates: string[];
}

const EMPTY_PASSPORT: CandidatePassport = {
  loadFailed: false,
  occupations: [], city: null, radiusKm: null, experienceYears: null,
  availability: null, skills: [], languages: [], certificates: [],
};

const FAILED_PASSPORT: CandidatePassport = { ...EMPTY_PASSPORT, loadFailed: true };

/* ---------------------------------------------------------------------------
 * Pomocnicze konwersje (bez `any`, wzorzec z @/lib/jobs)
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asNum(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asStrArrLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

/** Statusy aplikacji liczone jako „aktywne" (w toku rekrutacji). */
const ACTIVE_APPLICATION_STATUSES = [
  'submitted',
  'viewed',
  'shortlisted',
  'interview',
  'offer_sent',
  'offer_accepted',
] as const;

/** Ile najnowszych ofert publicznych trzymamy w mapie do wzbogacania po `job_id`. */
const PUBLIC_JOBS_LOOKUP_LIMIT = 100;

/* ---------------------------------------------------------------------------
 * Wspólne zapytania (ścieżka bazodanowa)
 * ------------------------------------------------------------------------- */

interface PublicJobLite {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  city: string;
}

/** Zwraca zalogowanego użytkownika (albo null). */
async function getAuthUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Klient serwerowy + sesja rozwiązywane RAZ na żądanie. `cache()` (React) memoizuje wynik
 * per-request — sześć loaderów panelu współdzieli jeden `createServerClient` + jedno
 * `auth.getUser()` zamiast tworzyć osobny klient i pytać o sesję każdy z osobna.
 */
const getServerContext = cache(
  async (): Promise<{ supabase: SupabaseClient; userId: string | null }> => {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const userId = await getAuthUserId(supabase);
    return { supabase, userId };
  },
);

/**
 * Liczba konwersacji z nieprzeczytanymi wiadomościami (model `conversation_members.last_read_at`,
 * spójny z `messages.getUnreadConversationsCount`). NIE liczymy po `messages.read_at` — ta kolumna
 * nie jest ustawiana, więc licznik po niej byłby zawyżony.
 */
async function countUnreadConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data: memberData, error: memberError } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('profile_id', userId);
  if (memberError) throw memberError;

  const lastReadByConv = new Map<string, string | null>();
  for (const row of asArr(memberData)) {
    const r = asRecord(row);
    const cid = asStr(r['conversation_id']);
    if (cid) {
      lastReadByConv.set(cid, typeof r['last_read_at'] === 'string' ? (r['last_read_at'] as string) : null);
    }
  }
  if (lastReadByConv.size === 0) return 0;

  const { data: msgData, error: msgError } = await supabase
    .from('messages')
    .select('conversation_id, sender_id, created_at')
    .in('conversation_id', [...lastReadByConv.keys()])
    .is('deleted_at', null);
  if (msgError) throw msgError;

  const unreadConvs = new Set<string>();
  for (const row of asArr(msgData)) {
    const r = asRecord(row);
    const cid = asStr(r['conversation_id']);
    if (!cid || unreadConvs.has(cid)) continue;
    const senderId = asStr(r['sender_id']);
    const createdAt = asStr(r['created_at']);
    const lastRead = lastReadByConv.get(cid) ?? null;
    if (senderId !== userId && createdAt && (!lastRead || createdAt > lastRead)) {
      unreadConvs.add(cid);
    }
  }
  return unreadConvs.size;
}

/**
 * Mapa job_id → bezpieczne dane publiczne oferty (RPC `get_public_jobs`).
 * `cache()` per-request — gdy kilka loaderów potrzebuje tej samej mapy (te same argumenty:
 * ten sam klient z `getServerContext`, locale, limit) RPC wykona się tylko raz.
 */
const fetchPublicJobsMap = cache(async (
  supabase: SupabaseClient,
  locale: Locale,
  limit: number,
): Promise<Map<string, PublicJobLite>> => {
  const { data, error } = await supabase.rpc('get_public_jobs', {
    p_locale: locale,
    p_keyword: null,
    p_city: null,
    p_limit: limit,
    p_offset: 0,
  });
  if (error) throw error;

  const map = new Map<string, PublicJobLite>();
  for (const row of asArr(data)) {
    const r = asRecord(row);
    const id = asStr(r['id']);
    if (!id) continue;
    map.set(id, {
      id,
      slug: asStr(r['slug']),
      title: asStr(r['title']),
      companyName: asStr(r['company_name']),
      city: asStr(r['city']),
    });
  }
  return map;
});

/**
 * Mapa job_id → bezpieczne dane oferty dla WŁASNYCH aplikacji kandydata (RPC
 * `get_applied_jobs_display`, 0023). W odróżnieniu od `fetchPublicJobsMap` zwraca też
 * oferty nieaktywne/wygasłe/spoza top-N — kandydat ma prawo widzieć ofertę, do której
 * aplikował. `cache()` per-request (te same argumenty → jedno wywołanie RPC).
 */
const fetchAppliedJobsMap = cache(async (
  supabase: SupabaseClient,
  locale: Locale,
): Promise<Map<string, PublicJobLite>> => {
  const { data, error } = await supabase.rpc('get_applied_jobs_display', { p_locale: locale });
  if (error) throw error;

  const map = new Map<string, PublicJobLite>();
  for (const row of asArr(data)) {
    const r = asRecord(row);
    const id = asStr(r['job_id']);
    if (!id) continue;
    map.set(id, {
      id,
      slug: asStr(r['slug']),
      title: asStr(r['title']),
      companyName: asStr(r['company_name']),
      city: asStr(r['city']),
    });
  }
  return map;
});

/** Zbiór job_id zapisanych przez kandydata. */
async function fetchSavedJobIds(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('saved_jobs')
    .select('job_id')
    .eq('candidate_id', userId);
  if (error) throw error;

  const set = new Set<string>();
  for (const row of asArr(data)) {
    const jobId = asStr(asRecord(row)['job_id']);
    if (jobId) set.add(jobId);
  }
  return set;
}

/**
 * Liczy kompletność profilu + checklistę + imię (jedno źródło dla overview i summary).
 * `cache()` per-request — gdy overview i summary renderują się w tym samym żądaniu,
 * komplet zapytań profilu policzy się tylko raz.
 */
const computeProfileSummary = cache(async (
  supabase: SupabaseClient,
  userId: string,
): Promise<CandidateProfileSummary> => {
  const [{ data: profileRow }, { data: cpRow }] = await Promise.all([
    supabase.from('profiles').select('first_name, last_name, avatar_url').eq('id', userId).maybeSingle(),
    supabase
      .from('candidate_profiles')
      .select('id, experience_years, occupations, categories, city')
      .eq('profile_id', userId)
      .maybeSingle(),
  ]);

  const profile = asRecord(profileRow);
  const cp = asRecord(cpRow);
  const candidateProfileId = asStr(cp['id']);

  let skillsCount = 0;
  let languagesCount = 0;
  if (candidateProfileId) {
    const [{ count: sc }, { count: lc }] = await Promise.all([
      supabase
        .from('candidate_skills')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_profile_id', candidateProfileId),
      supabase
        .from('candidate_languages')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_profile_id', candidateProfileId),
    ]);
    skillsCount = sc ?? 0;
    languagesCount = lc ?? 0;
  }

  const checklist = {
    basicInfo: Boolean(asStr(profile['first_name']) && asStr(profile['last_name'])),
    experience: typeof cp['experience_years'] === 'number',
    // Brak dedykowanej kolumny „wykształcenie" — proxy: uzupełnione preferencje zawodowe (krok 2).
    education: asStrArrLen(cp['occupations']) > 0 || asStrArrLen(cp['categories']) > 0,
    skills: skillsCount > 0,
    languages: languagesCount > 0,
    photo: Boolean(asStr(profile['avatar_url'])),
  };

  const doneCount = Object.values(checklist).filter(Boolean).length;
  const completionPct = Math.round((doneCount / 6) * 100);
  const firstName = asStr(profile['first_name']) || null;

  return { firstName, completionPct, checklist };
});

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez bazy) — złożone z ofert demonstracyjnych (lokalizowane, z realnymi slugami)
 * ------------------------------------------------------------------------- */

const DEMO_RECOMMENDED_SCORES = [92, 89, 87, 84, 82] as const;

function demoRecommended(locale: Locale): RecommendedJob[] {
  return resolveDemoJobs(locale)
    .slice(0, 5)
    .map((job, index) => ({
      id: job.id,
      slug: job.slug,
      title: job.title,
      companyName: job.companyName,
      city: job.city,
      match: DEMO_RECOMMENDED_SCORES[index] ?? 80,
      saved: false,
    }));
}

const DEMO_APPLICATION_PICKS = [
  { idx: 0, status: 'submitted', daysAgo: 2 },
  { idx: 6, status: 'viewed', daysAgo: 4 },
  { idx: 13, status: 'interview', daysAgo: 6 },
  { idx: 3, status: 'rejected', daysAgo: 13 },
] as const;

function demoApplications(locale: Locale): MyApplication[] {
  const jobs = resolveDemoJobs(locale);
  return DEMO_APPLICATION_PICKS.map((pick, index) => {
    const job = jobs[pick.idx];
    return {
      id: `demo-app-${index}`,
      jobTitle: job?.title ?? '',
      companyName: job?.companyName ?? '',
      slug: job?.slug ?? null,
      date: new Date(Date.now() - pick.daysAgo * 86_400_000).toISOString(),
      status: pick.status,
    };
  });
}

function demoSaved(locale: Locale): RecommendedJob[] {
  return resolveDemoJobs(locale)
    .slice(0, 4)
    .map((job) => ({
      id: job.id,
      slug: job.slug,
      title: job.title,
      companyName: job.companyName,
      city: job.city,
      match: null,
      saved: true,
    }));
}

const DEMO_OFFER_PICKS = [
  { idx: 1, status: 'sent', daysAgo: 1 },
  { idx: 5, status: 'accepted', daysAgo: 7 },
] as const;

function demoOffers(locale: Locale): MyOffer[] {
  const jobs = resolveDemoJobs(locale);
  return DEMO_OFFER_PICKS.map((pick, index) => {
    const job = jobs[pick.idx];
    return {
      id: `demo-offer-${index}`,
      jobTitle: job?.title ?? '',
      companyName: job?.companyName ?? '',
      slug: job?.slug ?? null,
      message: '',
      date: new Date(Date.now() - pick.daysAgo * 86_400_000).toISOString(),
      status: pick.status,
      expiresAt: null,
    };
  });
}

function latestDemoOffer(locale: Locale): MyOffer | null {
  const offers = demoOffers(locale);
  const latest = findLatestActiveProposal(
    offers.map((offer) => ({
      offer,
      id: offer.id,
      status: offer.status,
      sentAt: offer.date,
      expiresAt: null,
    })),
  );
  return latest?.offer ?? null;
}

function demoMessages(locale: Locale): LatestMessage[] {
  const jobs = resolveDemoJobs(locale);
  const previews = [jobs[0]?.title ?? '', jobs[2]?.title ?? '', jobs[4]?.title ?? ''];
  return demoCompanies.slice(0, 3).map((company, index) => ({
    id: `demo-msg-${index}`,
    title: company.name,
    preview: previews[index] ?? '',
    time: new Date(Date.now() - index * 86_400_000).toISOString(),
    unread: index === 0,
  }));
}

const DEMO_OVERVIEW: CandidateOverview = {
  newJobsCount: 24,
  activeApplicationsCount: 5,
  unreadMessagesCount: 2,
  profileCompletionPct: 0,
};

const DEMO_PROFILE_SUMMARY: CandidateProfileSummary = {
  firstName: null,
  completionPct: 0,
  checklist: {
    basicInfo: false,
    experience: false,
    education: false,
    skills: false,
    languages: false,
    photo: false,
  },
};

/* ---------------------------------------------------------------------------
 * Publiczne API danych panelu kandydata
 * ------------------------------------------------------------------------- */

/** Kafelki podsumowania: nowe oferty / aktywne aplikacje / nieprzeczytane wiadomości / kompletność profilu. */
export async function getCandidateOverview(): Promise<CandidateOverview> {
  if (!isSupabaseConfigured()) return DEMO_OVERVIEW;

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) {
      return { newJobsCount: 0, activeApplicationsCount: 0, unreadMessagesCount: 0, profileCompletionPct: 0 };
    }

    const [newJobs, activeApps, unreadCount, profile] = await Promise.all([
      supabase.rpc('get_public_jobs_count', {
        p_keyword: null,
        p_city: null,
      }),
      supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_id', userId)
        .is('deleted_at', null)
        .in('status', [...ACTIVE_APPLICATION_STATUSES]),
      countUnreadConversations(supabase, userId),
      computeProfileSummary(supabase, userId),
    ]);

    if (newJobs.error) throw newJobs.error;
    if (activeApps.error) throw activeApps.error;

    return {
      newJobsCount: asNum(newJobs.data),
      activeApplicationsCount: activeApps.count ?? 0,
      unreadMessagesCount: unreadCount,
      profileCompletionPct: profile.completionPct,
    };
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateOverview' });
    return { newJobsCount: 0, activeApplicationsCount: 0, unreadMessagesCount: 0, profileCompletionPct: 0 };
  }
}

/** Imię + kompletność profilu (pierścień) + checklista sekcji. */
export async function getCandidateProfileSummary(): Promise<CandidateProfileSummary> {
  if (!isSupabaseConfigured()) return DEMO_PROFILE_SUMMARY;

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) {
      return {
        firstName: null,
        completionPct: 0,
        checklist: { basicInfo: false, experience: false, education: false, skills: false, languages: false, photo: false },
      };
    }
    return await computeProfileSummary(supabase, userId);
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateProfileSummary' });
    return {
      firstName: null,
      completionPct: 0,
      checklist: { basicInfo: false, experience: false, education: false, skills: false, languages: false, photo: false },
    };
  }
}

/** Własny paszport zawodowy; przy błędzie nie podstawiamy fikcyjnych danych demonstracyjnych. */
export async function getCandidatePassport(): Promise<CandidatePassport> {
  if (!isSupabaseConfigured()) return EMPTY_PASSPORT;

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return EMPTY_PASSPORT;

    const { data, error } = await supabase
      .from('candidate_profiles')
      .select('id, occupations, city, radius_km, experience_years, availability')
      .eq('profile_id', userId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return EMPTY_PASSPORT;

    const profile = asRecord(data);
    const candidateProfileId = asStr(profile['id']);
    const [skills, languages, certificates] = await Promise.all([
      supabase.from('candidate_skills').select('skill_label').eq('candidate_profile_id', candidateProfileId),
      supabase.from('candidate_languages').select('language_label').eq('candidate_profile_id', candidateProfileId),
      supabase.from('candidate_certificates').select('certificate_label').eq('candidate_profile_id', candidateProfileId),
    ]);
    if (skills.error) throw skills.error;
    if (languages.error) throw languages.error;
    if (certificates.error) throw certificates.error;

    const labels = (rows: unknown, key: string): string[] => asArr(rows)
      .map((row) => asStr(asRecord(row)[key]).trim())
      .filter(Boolean);
    return {
      loadFailed: false,
      occupations: asArr(profile['occupations']).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      city: asStr(profile['city']) || null,
      radiusKm: typeof profile['radius_km'] === 'number' ? profile['radius_km'] : null,
      experienceYears: typeof profile['experience_years'] === 'number' ? profile['experience_years'] : null,
      availability: asStr(profile['availability']) || null,
      skills: labels(skills.data, 'skill_label'),
      languages: labels(languages.data, 'language_label'),
      certificates: labels(certificates.data, 'certificate_label'),
    };
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidatePassport' });
    return FAILED_PASSPORT;
  }
}

/** Polecane oferty: z `matches` kandydata (score desc), wzbogacone o dane publiczne; fallback = najnowsze oferty. */
export async function getRecommendedJobs(locale: string): Promise<RecommendedJob[]> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) return demoRecommended(resolvedLocale);

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return [];

    const [matchRes, jobsMap, savedIds] = await Promise.all([
      supabase
        .from('matches')
        .select('job_id, score')
        .eq('candidate_id', userId)
        .order('score', { ascending: false })
        .limit(20),
      fetchPublicJobsMap(supabase, resolvedLocale, PUBLIC_JOBS_LOOKUP_LIMIT),
      fetchSavedJobIds(supabase, userId),
    ]);
    if (matchRes.error) throw matchRes.error;

    // 1) Realne dopasowania (tylko te wciąż aktywne/publiczne, więc obecne w mapie).
    const matched: RecommendedJob[] = [];
    for (const row of asArr(matchRes.data)) {
      const r = asRecord(row);
      const jobId = asStr(r['job_id']);
      const job = jobId ? jobsMap.get(jobId) : undefined;
      if (!job) continue;
      matched.push({ ...job, match: asNum(r['score']), saved: savedIds.has(job.id) });
      if (matched.length >= 5) break;
    }
    if (matched.length > 0) return matched;

    // 2) Fallback: najnowsze oferty publiczne (bez policzonego matchu).
    const latest: RecommendedJob[] = [];
    for (const job of jobsMap.values()) {
      latest.push({ ...job, match: null, saved: savedIds.has(job.id) });
      if (latest.length >= 5) break;
    }
    return latest;
  } catch (error) {
    captureError(error, { area: 'candidate.getRecommendedJobs' });
    return [];
  }
}

/** Ostatnie aplikacje kandydata (applications + publiczne dane oferty). */
export async function getMyApplications(locale: string = routing.defaultLocale, throwOnError = false): Promise<MyApplication[]> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) return demoApplications(resolvedLocale);

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return [];

    const { data, error } = await supabase
      .from('applications')
      .select('id, job_id, status, submitted_at')
      .eq('candidate_id', userId)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .limit(10);
    if (error) throw error;

    const rows = asArr(data);
    if (rows.length === 0) return [];

    // Wzbogacamy danymi oferty przez dedykowane RPC ograniczone do WŁASNYCH aplikacji
    // (auth.uid()) — zwraca tytuł/firmę/slug NIEZALEŻNIE od statusu oferty, więc aplikacje
    // do ofert zamkniętych/wstrzymanych/wygasłych nie tracą nazwy (get_public_jobs zwraca
    // tylko active+verified top-N, przez co dawały puste wiersze).
    const jobsMap = await fetchAppliedJobsMap(supabase, resolvedLocale);
    return rows.map((row) => {
      const r = asRecord(row);
      const job = jobsMap.get(asStr(r['job_id']));
      return {
        id: asStr(r['id']),
        jobTitle: job?.title ?? '',
        companyName: job?.companyName ?? '',
        slug: job?.slug ?? null,
        date: asStr(r['submitted_at']),
        status: asStr(r['status'], 'submitted'),
      };
    });
  } catch (error) {
    captureError(error, { area: 'candidate.getMyApplications' });
    if (throwOnError) throw error;
    return [];
  }
}

/**
 * Zapisane oferty kandydata przez RPC, które łączy własne `saved_jobs` z aktywnymi,
 * publicznymi ofertami przed sortowaniem. Nie ograniczamy się do najnowszych 100 ofert,
 * bo stara, nadal aktywna oferta również może być zapisana.
 */
export type SavedJobsResult =
  | { status: 'ready'; jobs: RecommendedJob[] }
  | { status: 'error' };

export async function getSavedJobs(locale: string = routing.defaultLocale): Promise<SavedJobsResult> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) return { status: 'ready', jobs: demoSaved(resolvedLocale) };

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return { status: 'error' };

    const { data, error } = await supabase.rpc('get_saved_jobs_display', { p_locale: resolvedLocale });
    if (error) throw error;
    const jobs = asArr(data).map((row): RecommendedJob => {
      const item = asRecord(row);
      return {
        id: asStr(item['id']),
        slug: asStr(item['slug']),
        title: asStr(item['title']),
        companyName: asStr(item['company_name']),
        city: asStr(item['city']),
        match: null,
        saved: true,
      };
    });
    return { status: 'ready', jobs };
  } catch (error) {
    captureError(error, { area: 'candidate.getSavedJobs' });
    return { status: 'error' };
  }
}

/**
 * Propozycje pracy wysłane do kandydata (`offers`) + dane oferty.
 * Odczyt pod sesją (RLS `offers_select`: kandydat widzi wyłącznie własne propozycje). Tytuł/firmę
 * rozwiązujemy z RPC `get_applied_jobs_display` (własne aplikacje, niezależnie od statusu oferty),
 * a jako uzupełnienie z `get_public_jobs` (propozycja może dotyczyć oferty, do której kandydat nie
 * aplikował) — kandydat nie czyta tabel bazowych wprost (P1-01).
 */
export async function getMyOffers(locale: string = routing.defaultLocale, throwOnError = false): Promise<MyOffer[]> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) return demoOffers(resolvedLocale);

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return [];

    const { data, error } = await supabase
      .from('offers')
      .select('id, job_id, status, message, sent_at, created_at, expires_at')
      .eq('candidate_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;

    const rows = asArr(data);
    if (rows.length === 0) return [];

    const [appliedMap, publicMap] = await Promise.all([
      fetchAppliedJobsMap(supabase, resolvedLocale),
      fetchPublicJobsMap(supabase, resolvedLocale, PUBLIC_JOBS_LOOKUP_LIMIT),
    ]);

    return rows.map((row) => {
      const r = asRecord(row);
      const jobId = asStr(r['job_id']);
      const job = appliedMap.get(jobId) ?? publicMap.get(jobId);
      const sentAt = asStr(r['sent_at']);
      return {
        id: asStr(r['id']),
        jobTitle: job?.title ?? '',
        companyName: job?.companyName ?? '',
        slug: job?.slug ?? null,
        message: asStr(r['message']),
        date: sentAt || asStr(r['created_at']),
        status: asStr(r['status'], 'sent'),
        expiresAt: asStr(r['expires_at']) || null,
      };
    });
  } catch (error) {
    captureError(error, { area: 'candidate.getMyOffers' });
    if (throwOnError) throw error;
    return [];
  }
}

/**
 * Najnowsza niewygasła propozycja oczekująca na odpowiedź. Filtry, kolejność i limit działają
 * w bazie przed pobraniem wiersza; odczyt pozostaje pod sesją i polityką RLS `offers_select`.
 */
export async function getLatestActiveOffer(
  locale: string = routing.defaultLocale,
): Promise<MyOffer | null> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) return latestDemoOffer(resolvedLocale);

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return null;

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('offers')
      .select('id, job_id, status, message, sent_at, expires_at')
      .eq('candidate_id', userId)
      .is('deleted_at', null)
      .in('status', ['sent', 'viewed'])
      .not('sent_at', 'is', null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = asRecord(data);
    const jobId = asStr(row['job_id']);
    const [appliedMap, publicMap] = await Promise.all([
      fetchAppliedJobsMap(supabase, resolvedLocale),
      fetchPublicJobsMap(supabase, resolvedLocale, PUBLIC_JOBS_LOOKUP_LIMIT),
    ]);
    const job = appliedMap.get(jobId) ?? publicMap.get(jobId);

    return {
      id: asStr(row['id']),
      jobTitle: job?.title ?? '',
      companyName: job?.companyName ?? '',
      slug: job?.slug ?? null,
      message: asStr(row['message']),
      date: asStr(row['sent_at']),
      status: asStr(row['status']),
      expiresAt: asStr(row['expires_at']) || null,
    };
  } catch (error) {
    captureError(error, { area: 'candidate.getLatestActiveOffer' });
    return null;
  }
}

/** Ostatnie wiadomości/konwersacje kandydata (puste, gdy brak). */
export async function getLatestMessages(): Promise<LatestMessage[]> {
  if (!isSupabaseConfigured()) return demoMessages(routing.defaultLocale);

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return [];

    const { data: memberData, error: memberError } = await supabase
      .from('conversation_members')
      .select('conversation_id, last_read_at')
      .eq('profile_id', userId);
    if (memberError) throw memberError;

    const lastReadByConv = new Map<string, string | null>();
    for (const row of asArr(memberData)) {
      const r = asRecord(row);
      const cid = asStr(r['conversation_id']);
      if (cid) lastReadByConv.set(cid, typeof r['last_read_at'] === 'string' ? (r['last_read_at'] as string) : null);
    }
    if (lastReadByConv.size === 0) return [];

    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, subject, last_message_at')
      .in('id', [...lastReadByConv.keys()])
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(3);
    if (convError) throw convError;

    const convs = asArr(convData);
    if (convs.length === 0) return [];
    const topIds = convs.map((c) => asStr(asRecord(c)['id'])).filter(Boolean);

    const { data: msgData, error: msgError } = await supabase
      .from('messages')
      .select('conversation_id, body, sender_id, created_at')
      .in('conversation_id', topIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (msgError) throw msgError;

    const latestByConv = new Map<string, { body: string; createdAt: string; senderId: string }>();
    for (const row of asArr(msgData)) {
      const r = asRecord(row);
      const cid = asStr(r['conversation_id']);
      if (!cid || latestByConv.has(cid)) continue;
      latestByConv.set(cid, {
        body: asStr(r['body']),
        createdAt: asStr(r['created_at']),
        senderId: asStr(r['sender_id']),
      });
    }

    return convs.map((c) => {
      const r = asRecord(c);
      const cid = asStr(r['id']);
      const last = latestByConv.get(cid);
      const lastRead = lastReadByConv.get(cid) ?? null;
      const unread = Boolean(
        last && last.senderId !== userId && last.createdAt && (!lastRead || last.createdAt > lastRead),
      );
      return {
        id: cid,
        title: asStr(r['subject']),
        preview: last?.body ?? '',
        time: last?.createdAt || asStr(r['last_message_at']),
        unread,
      };
    });
  } catch (error) {
    captureError(error, { area: 'candidate.getLatestMessages' });
    return [];
  }
}

/** Element listy dokumentów kandydata (CV) z krótkotrwałym signed URL. */
export interface CandidateFile {
  id: string;
  fileName: string;
  url: string | null;
}

/**
 * Dokumenty kandydata (CV) z tabeli files + signed URL do każdego (Invariant #10).
 * Bez env / błąd -> pusta lista (panel działa dalej).
 */
export async function getCandidateFiles(): Promise<CandidateFile[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { getSignedFileUrl } = await import('@/lib/storage');
    const { supabase, userId } = await getServerContext();
    if (!userId) return [];

    const { data, error } = await supabase
      .from('files')
      .select('id, path, bucket, file_name')
      .eq('owner_id', userId)
      .eq('entity_type', 'candidate_cv')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = asArr(data);
    return Promise.all(
      rows.map(async (row) => {
        const r = asRecord(row);
        const path = asStr(r['path']);
        const bucket = asStr(r['bucket']) || undefined;
        return {
          id: asStr(r['id']),
          fileName: asStr(r['file_name']) || path.split('/').pop() || 'CV',
          url: path ? await getSignedFileUrl(path, bucket) : null,
        };
      }),
    );
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateFiles' });
    return [];
  }
}
