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
 * i degradujemy do bezpiecznej struktury, a nie do danych DEMO. Odczyty profilu
 * oznaczają awarię osobnym `loadFailed`, aby nie udawać 0% kompletności.
 */

import { cache } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { routing, type Locale } from '@/i18n/routing';
import { demoCompanies, resolveDemoJobs } from '@/lib/data/demo';
import { findLatestActiveProposal } from '@/lib/candidate-offers';
import { customOfferMessage } from '@/lib/offers/default-message';
import {
  EMPTY_PROFILE_CHECKLIST,
  completionPctOf,
  computeProfileChecklist,
  type ProfileChecklistState,
} from '@/lib/profile-completeness';

/* ---------------------------------------------------------------------------
 * Kontrakt danych panelu kandydata
 * ------------------------------------------------------------------------- */

/**
 * Liczniki pulpitu. `null` = odczyt tego licznika się nie udał — ekran pokazuje błąd,
 * a nie zero udające potwierdzony wynik (#244). Każdy licznik zawodzi niezależnie.
 */
export interface CandidateOverview {
  newJobsCount: number | null;
  activeApplicationsCount: number | null;
  unreadMessagesCount: number | null;
  profileCompletionPct: number;
}

/** Wynik odczytu sekcji pulpitu: awaria nigdy nie jest zamieniana na pustą listę (#244). */
export type CandidateSectionLoad<T> = { status: 'ok'; items: T[] } | { status: 'error' };

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

export interface ApplicationCursor {
  submittedAt: string;
  id: string;
}

export interface MyApplicationsPage {
  items: MyApplication[];
  nextCursor: ApplicationCursor | null;
}

const APPLICATION_PAGE_SIZE = 10;

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

export interface OfferCursor {
  createdAt: string;
  id: string;
}

export interface MyOffersPage {
  items: MyOffer[];
  nextCursor: OfferCursor | null;
}

const OFFER_PAGE_SIZE = 10;

export interface CandidateProfileSummary {
  loadFailed: boolean;
  firstName: string | null;
  completionPct: number;
  /** Sekcje = kroki kreatora (`PROFILE_SECTIONS`, #315). */
  checklist: ProfileChecklistState;
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
  return toAppliedJobsMap(data);
});

/**
 * Mapa job_id → dane oferty dla WŁASNYCH propozycji kandydata (RPC `get_offered_jobs_display`,
 * 0090). Jak `fetchAppliedJobsMap`: niezależnie od statusu oferty, top-N listy i blokad firm (#97)
 * — historia propozycji zachowuje tytuł i firmę. `cache()` per-request.
 */
const fetchOfferedJobsMap = cache(async (
  supabase: SupabaseClient,
  locale: Locale,
): Promise<Map<string, PublicJobLite>> => {
  const { data, error } = await supabase.rpc('get_offered_jobs_display', { p_locale: locale });
  if (error) throw error;
  return toAppliedJobsMap(data);
});

/**
 * Metadane ofert tylko dla `job_id` jednej strony historii zgłoszeń (#184). Filtr `in`
 * zawęża wynik RPC po stronie bazy, więc „Pokaż więcej” nie przesyła danych całej historii.
 * RPC zwraca wyłącznie oferty własnych aplikacji (auth.uid()), dlatego cudze lub
 * niepowiązane `job_id` w filtrze nie dają żadnego wiersza.
 */
async function fetchAppliedJobsForPage(
  supabase: SupabaseClient,
  locale: Locale,
  jobIds: string[],
): Promise<Map<string, PublicJobLite>> {
  const ids = [...new Set(jobIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .rpc('get_applied_jobs_display', { p_locale: locale })
    .in('job_id', ids);
  if (error) throw error;
  return toAppliedJobsMap(data);
}

function toAppliedJobsMap(data: unknown): Map<string, PublicJobLite> {
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
}

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
  const [profileResult, candidateResult] = await Promise.all([
    supabase.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle(),
    supabase
      .from('candidate_profiles')
      .select('id, experience_years, occupations, categories, city, availability')
      .eq('profile_id', userId)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (candidateResult.error) throw candidateResult.error;

  const profile = asRecord(profileResult.data);
  const cp = asRecord(candidateResult.data);
  const candidateProfileId = asStr(cp['id']);

  let languagesCount = 0;
  let certificatesCount = 0;
  if (candidateProfileId) {
    const [languagesResult, certificatesResult] = await Promise.all([
      supabase
        .from('candidate_languages')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_profile_id', candidateProfileId),
      supabase
        .from('candidate_certificates')
        .select('id', { count: 'exact', head: true })
        .eq('candidate_profile_id', candidateProfileId),
    ]);
    if (languagesResult.error) throw languagesResult.error;
    if (certificatesResult.error) throw certificatesResult.error;
    languagesCount = languagesResult.count ?? 0;
    certificatesCount = certificatesResult.count ?? 0;
  }

  // Kryteria = kroki kreatora; ta sama definicja co na profilu i w linkach „Dodaj" (#315).
  const checklist = computeProfileChecklist({
    firstName: asStr(profile['first_name']) || null,
    lastName: asStr(profile['last_name']) || null,
    occupationsCount: asStrArrLen(cp['occupations']),
    categoriesCount: asStrArrLen(cp['categories']),
    experienceYears: cp['experience_years'],
    city: asStr(cp['city']) || null,
    languagesCount,
    certificatesCount,
    availability: asStr(cp['availability']) || null,
  });

  const completionPct = completionPctOf(checklist);
  const firstName = asStr(profile['first_name']) || null;

  return { loadFailed: false, firstName, completionPct, checklist };
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
  // Te same identyfikatory i firmy co demo rozmów (`lib/data/messages`), aby link otwierał wątek (#340).
  return [0, 2, 6].map((companyIdx, index) => ({
    id: `demo-conv-${index}`,
    title: demoCompanies[companyIdx]?.name ?? '',
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
  loadFailed: false,
  firstName: null,
  completionPct: 0,
  checklist: EMPTY_PROFILE_CHECKLIST,
};

const FAILED_PROFILE_SUMMARY: CandidateProfileSummary = {
  ...DEMO_PROFILE_SUMMARY,
  loadFailed: true,
};

/* ---------------------------------------------------------------------------
 * Publiczne API danych panelu kandydata
 * ------------------------------------------------------------------------- */

/** Kafelki podsumowania: nowe oferty / aktywne aplikacje / nieprzeczytane wiadomości / kompletność profilu. */
export async function getCandidateOverview(): Promise<CandidateOverview> {
  if (!isSupabaseConfigured()) {
    if (isDashboardErrorFixture()) {
      return { newJobsCount: null, activeApplicationsCount: null, unreadMessagesCount: null, profileCompletionPct: 0 };
    }
    return DEMO_OVERVIEW;
  }

  /** Awaria jednego licznika daje `null` tylko dla niego; pozostałe zachowują prawdziwe wartości. */
  const settle = async (area: string, read: () => Promise<number>): Promise<number | null> => {
    try {
      return await read();
    } catch (error) {
      captureError(error, { area: `candidate.getCandidateOverview.${area}` });
      return null;
    }
  };

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) {
      return { newJobsCount: 0, activeApplicationsCount: 0, unreadMessagesCount: 0, profileCompletionPct: 0 };
    }

    const [newJobsCount, activeApplicationsCount, unreadMessagesCount, profile] = await Promise.all([
      settle('newJobs', async () => {
        const { data, error } = await supabase.rpc('get_public_jobs_count', {
          p_keyword: null,
          p_city: null,
        });
        if (error) throw error;
        return asNum(data);
      }),
      settle('activeApplications', async () => {
        const { count, error } = await supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('candidate_id', userId)
          .is('deleted_at', null)
          .in('status', [...ACTIVE_APPLICATION_STATUSES]);
        if (error) throw error;
        return count ?? 0;
      }),
      settle('unreadMessages', () => countUnreadConversations(supabase, userId)),
      computeProfileSummary(supabase, userId).catch((error: unknown) => {
        captureError(error, { area: 'candidate.getCandidateOverview.profileSummary' });
        return FAILED_PROFILE_SUMMARY;
      }),
    ]);

    return {
      newJobsCount,
      activeApplicationsCount,
      unreadMessagesCount,
      profileCompletionPct: profile.completionPct,
    };
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateOverview' });
    return { newJobsCount: null, activeApplicationsCount: null, unreadMessagesCount: null, profileCompletionPct: 0 };
  }
}

/** Imię + kompletność profilu (pierścień) + checklista sekcji. */
export async function getCandidateProfileSummary(): Promise<CandidateProfileSummary> {
  if (!isSupabaseConfigured()) return DEMO_PROFILE_SUMMARY;

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) {
      return DEMO_PROFILE_SUMMARY;
    }
    return await computeProfileSummary(supabase, userId);
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateProfileSummary' });
    return FAILED_PROFILE_SUMMARY;
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

/** Ile najlepszych dopasowań bierzemy pod uwagę przy polecanych (część może być już niepubliczna). */
const RECOMMENDED_MATCHES_LIMIT = 50;
const RECOMMENDED_LIMIT = 5;

/**
 * Publiczne dane DOKŁADNIE dla podanych ofert (RPC `get_public_jobs_by_ids`, 0074) — te same
 * filtry widoczności co lista publiczna (active, niewygasła, firma verified), tłumaczenie w locale.
 */
async function fetchPublicJobsByIds(
  supabase: SupabaseClient,
  locale: Locale,
  ids: string[],
): Promise<Map<string, PublicJobLite>> {
  const map = new Map<string, PublicJobLite>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc('get_public_jobs_by_ids', { p_ids: ids, p_locale: locale });
  if (error) throw error;
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
}

/**
 * Polecane oferty: najlepsze `matches` kandydata (score desc, job_id jako rozstrzygnięcie),
 * wzbogacone o dane publiczne dokładnie tych ofert — niezależnie od ich wieku (#196).
 * Fallback = najnowsze oferty, tylko gdy żadne dopasowanie nie jest już publiczne.
 */
export async function getRecommendedJobs(locale: string, throwOnError = false): Promise<RecommendedJob[]> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) return demoRecommended(resolvedLocale);

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return [];

    const [matchRes, savedIds] = await Promise.all([
      supabase
        .from('matches')
        .select('job_id, score')
        .eq('candidate_id', userId)
        .order('score', { ascending: false })
        .order('job_id', { ascending: true })
        .limit(RECOMMENDED_MATCHES_LIMIT),
      fetchSavedJobIds(supabase, userId),
    ]);
    if (matchRes.error) throw matchRes.error;

    const matchRows = asArr(matchRes.data).map((row) => {
      const r = asRecord(row);
      return { jobId: asStr(r['job_id']), score: asNum(r['score']) };
    }).filter((row) => row.jobId.length > 0);
    const jobsById = await fetchPublicJobsByIds(
      supabase,
      resolvedLocale,
      [...new Set(matchRows.map((row) => row.jobId))],
    );

    // 1) Realne dopasowania w kolejności wyniku (tylko wciąż aktywne/publiczne).
    const matched: RecommendedJob[] = [];
    const seen = new Set<string>();
    for (const row of matchRows) {
      const job = jobsById.get(row.jobId);
      if (!job || seen.has(job.id)) continue;
      seen.add(job.id);
      matched.push({ ...job, match: row.score, saved: savedIds.has(job.id) });
      if (matched.length >= RECOMMENDED_LIMIT) break;
    }
    if (matched.length > 0) return matched;

    const jobsMap = await fetchPublicJobsMap(supabase, resolvedLocale, PUBLIC_JOBS_LOOKUP_LIMIT);
    // 2) Fallback: najnowsze oferty publiczne (bez policzonego matchu). Przepuszczamy je przez
    // RPC po ID, które pod sesją pomija oferty firm zablokowanych przez kandydata (#97).
    const allowed = await fetchPublicJobsByIds(supabase, resolvedLocale, [...jobsMap.keys()].slice(0, 100));
    const latest: RecommendedJob[] = [];
    for (const job of jobsMap.values()) {
      if (!allowed.has(job.id)) continue;
      latest.push({ ...job, match: null, saved: savedIds.has(job.id) });
      if (latest.length >= RECOMMENDED_LIMIT) break;
    }
    return latest;
  } catch (error) {
    captureError(error, { area: 'candidate.getRecommendedJobs' });
    if (throwOnError) throw error;
    return [];
  }
}

/**
 * Izolowany test przeglądarkowy (osobny serwer Next dev, bez bazy) wymusza błędy odczytu pulpitu.
 * Ta gałąź nie działa w buildzie produkcyjnym.
 */
function isDashboardErrorFixture(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'error';
}

/** Historia własnych zgłoszeń, stronicowana stabilnym kursorem (czas + UUID). */
export async function getMyApplicationsPage(
  locale: string = routing.defaultLocale,
  cursor: ApplicationCursor | null = null,
): Promise<MyApplicationsPage> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) {
    // Test przeglądarkowy uruchamia osobny serwer Next dev. Ta gałąź nie działa w buildzie produkcyjnym.
    if (process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full') {
      return developmentApplicationFixture(resolvedLocale, cursor);
    }
    if (process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'error') {
      throw new Error('Isolated application history fixture failure');
    }
    return { items: cursor ? [] : demoApplications(resolvedLocale), nextCursor: null };
  }

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return { items: [], nextCursor: null };

    let query = supabase
      .from('applications')
      .select('id, job_id, status, submitted_at')
      .eq('candidate_id', userId)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .order('id', { ascending: false });
    if (cursor) {
      // PostgREST wymaga cudzysłowu dla wartości z dwukropkiem i kropką (ISO 8601).
      // Kursor z Server Action jest sprawdzany przez Zod przed trafieniem tutaj.
      const timestamp = `"${cursor.submittedAt}"`;
      query = query.or(
        `submitted_at.lt.${timestamp},and(submitted_at.eq.${timestamp},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query.limit(APPLICATION_PAGE_SIZE + 1);
    if (error) throw error;

    const rows = asArr(data);
    if (rows.length === 0) return { items: [], nextCursor: null };
    const visibleRows = rows.slice(0, APPLICATION_PAGE_SIZE);
    const last = asRecord(visibleRows[visibleRows.length - 1]);
    const nextCursor = rows.length > APPLICATION_PAGE_SIZE
      ? { submittedAt: asStr(last['submitted_at']), id: asStr(last['id']) }
      : null;

    // Wzbogacamy danymi oferty przez dedykowane RPC ograniczone do WŁASNYCH aplikacji
    // (auth.uid()) — zwraca tytuł/firmę/slug NIEZALEŻNIE od statusu oferty, więc aplikacje
    // do ofert zamkniętych/wstrzymanych/wygasłych nie tracą nazwy (get_public_jobs zwraca
    // tylko active+verified top-N, przez co dawały puste wiersze).
    // Tylko oferty z tej strony (#184), nie cała historia.
    const jobsMap = await fetchAppliedJobsForPage(
      supabase,
      resolvedLocale,
      visibleRows.map((row) => asStr(asRecord(row)['job_id'])),
    );
    const items = visibleRows.map((row) => {
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
    return { items, nextCursor };
  } catch (error) {
    captureError(error, { area: 'candidate.getMyApplicationsPage' });
    throw error;
  }
}

/** Dane wyłącznie dla izolowanego testu Next dev; produkcyjny kompilator usuwa tę ścieżkę. */
function developmentApplicationFixture(locale: Locale, cursor: ApplicationCursor | null): MyApplicationsPage {
  const jobs = resolveDemoJobs(locale);
  const submittedAt = '2026-09-20T09:00:00+00:00';
  const all = Array.from({ length: 15 }, (_, index) => {
    const job = jobs[index];
    return {
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(15 - index).padStart(12, '0')}`,
      jobTitle: job?.title ?? '',
      companyName: job?.companyName ?? '',
      slug: job?.slug ?? null,
      date: submittedAt,
      status: 'submitted',
    };
  });
  const remaining = cursor
    ? all.filter((item) => item.date < cursor.submittedAt || (item.date === cursor.submittedAt && item.id < cursor.id))
    : all;
  const items = remaining.slice(0, APPLICATION_PAGE_SIZE);
  const last = items[items.length - 1];
  return { items, nextCursor: remaining.length > APPLICATION_PAGE_SIZE && last ? { submittedAt: last.date, id: last.id } : null };
}

/**
 * Krótki podgląd na pulpicie; pełna historia jest stronicowana na ekranie zgłoszeń.
 * Awaria odczytu to jawny stan `error` — nie pusta lista udająca brak zgłoszeń (#244).
 */
export async function getMyApplicationsPreview(
  locale: string = routing.defaultLocale,
): Promise<CandidateSectionLoad<MyApplication>> {
  try {
    return { status: 'ok', items: (await getMyApplicationsPage(locale)).items };
  } catch {
    // getMyApplicationsPage zgłosił już błąd do Sentry.
    return { status: 'error' };
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
 * Propozycje pracy wysłane do kandydata (`offers`) + dane oferty, stronicowane stabilnym kursorem
 * (`created_at` + UUID), aby cała historia była osiągalna bez sztucznego limitu (#245).
 * Odczyt pod sesją (RLS `offers_select`: kandydat widzi wyłącznie własne propozycje). Tytuł/firmę
 * rozwiązujemy z RPC `get_applied_jobs_display` (własne aplikacje, niezależnie od statusu oferty),
 * a jako uzupełnienie z `get_offered_jobs_display` (oferty własnych propozycji, także bez aplikacji
 * i od firm zablokowanych, #97) — kandydat nie czyta tabel bazowych wprost (P1-01). Błąd odczytu jest rzucany dalej,
 * nigdy nie udaje pustej strony.
 */
export async function getMyOffersPage(
  locale: string = routing.defaultLocale,
  cursor: OfferCursor | null = null,
): Promise<MyOffersPage> {
  const resolvedLocale = toLocale(locale);
  if (!isSupabaseConfigured()) {
    // Test przeglądarkowy uruchamia osobny serwer Next dev. Ta gałąź nie działa w buildzie produkcyjnym.
    if (process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full') {
      return developmentOfferFixture(resolvedLocale, cursor);
    }
    return { items: cursor ? [] : demoOffers(resolvedLocale), nextCursor: null };
  }

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return { items: [], nextCursor: null };

    let query = supabase
      .from('offers')
      .select('id, job_id, status, message, sent_at, created_at, expires_at')
      .eq('candidate_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (cursor) {
      // PostgREST wymaga cudzysłowu dla wartości z dwukropkiem i kropką (ISO 8601).
      // Kursor z Server Action jest sprawdzany przez Zod przed trafieniem tutaj.
      const timestamp = `"${cursor.createdAt}"`;
      query = query.or(
        `created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query.limit(OFFER_PAGE_SIZE + 1);
    if (error) throw error;

    const rows = asArr(data);
    if (rows.length === 0) return { items: [], nextCursor: null };
    const visibleRows = rows.slice(0, OFFER_PAGE_SIZE);
    const last = asRecord(visibleRows[visibleRows.length - 1]);
    const nextCursor = rows.length > OFFER_PAGE_SIZE
      ? { createdAt: asStr(last['created_at']), id: asStr(last['id']) }
      : null;

    const [appliedMap, offeredMap] = await Promise.all([
      fetchAppliedJobsMap(supabase, resolvedLocale),
      fetchOfferedJobsMap(supabase, resolvedLocale),
    ]);

    const items = visibleRows.map((row): MyOffer => {
      const r = asRecord(row);
      const jobId = asStr(r['job_id']);
      const job = appliedMap.get(jobId) ?? offeredMap.get(jobId);
      const sentAt = asStr(r['sent_at']);
      return {
        id: asStr(r['id']),
        jobTitle: job?.title ?? '',
        companyName: job?.companyName ?? '',
        slug: job?.slug ?? null,
        // Szablon zapisany w języku nadawcy → '' (UI pokaże zaproszenie w języku kandydata, #289).
        message: customOfferMessage(asStr(r['message'])) ?? '',
        date: sentAt || asStr(r['created_at']),
        status: asStr(r['status'], 'sent'),
        expiresAt: asStr(r['expires_at']) || null,
      };
    });
    return { items, nextCursor };
  } catch (error) {
    captureError(error, { area: 'candidate.getMyOffersPage' });
    throw error;
  }
}

/** Dane wyłącznie dla izolowanego testu Next dev (21 propozycji o równym czasie); produkcja tego nie wykonuje. */
function developmentOfferFixture(locale: Locale, cursor: OfferCursor | null): MyOffersPage {
  const jobs = resolveDemoJobs(locale);
  const createdAt = '2026-09-20T09:00:00+00:00';
  const all = Array.from({ length: 21 }, (_, index) => {
    const job = jobs[index % Math.max(jobs.length, 1)];
    return {
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(21 - index).padStart(12, '0')}`,
      jobTitle: `${job?.title ?? ''} #${21 - index}`,
      companyName: job?.companyName ?? '',
      slug: job?.slug ?? null,
      message: '',
      date: createdAt,
      status: index === 20 ? 'accepted' : 'declined',
      expiresAt: null,
    };
  });
  const remaining = cursor
    ? all.filter((item) => item.date < cursor.createdAt || (item.date === cursor.createdAt && item.id < cursor.id))
    : all;
  const items = remaining.slice(0, OFFER_PAGE_SIZE);
  const last = items[items.length - 1];
  return { items, nextCursor: remaining.length > OFFER_PAGE_SIZE && last ? { createdAt: last.date, id: last.id } : null };
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
    const [appliedMap, offeredMap] = await Promise.all([
      fetchAppliedJobsMap(supabase, resolvedLocale),
      fetchOfferedJobsMap(supabase, resolvedLocale),
    ]);
    const job = appliedMap.get(jobId) ?? offeredMap.get(jobId);

    return {
      id: asStr(row['id']),
      jobTitle: job?.title ?? '',
      companyName: job?.companyName ?? '',
      slug: job?.slug ?? null,
      message: customOfferMessage(asStr(row['message'])) ?? '',
      date: asStr(row['sent_at']),
      status: asStr(row['status']),
      expiresAt: asStr(row['expires_at']) || null,
    };
  } catch (error) {
    captureError(error, { area: 'candidate.getLatestActiveOffer' });
    return null;
  }
}

/** Ostatnie wiadomości/konwersacje kandydata. Pusta lista tylko po udanym odczycie (#244). */
export async function getLatestMessages(): Promise<CandidateSectionLoad<LatestMessage>> {
  if (!isSupabaseConfigured()) {
    if (isDashboardErrorFixture()) return { status: 'error' };
    return { status: 'ok', items: demoMessages(routing.defaultLocale) };
  }

  try {
    const { supabase, userId } = await getServerContext();
    if (!userId) return { status: 'ok', items: [] };

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
    if (lastReadByConv.size === 0) return { status: 'ok', items: [] };

    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, subject, last_message_at')
      .in('id', [...lastReadByConv.keys()])
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(3);
    if (convError) throw convError;

    const convs = asArr(convData);
    if (convs.length === 0) return { status: 'ok', items: [] };
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

    const items = convs.map((c): LatestMessage => {
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
    return { status: 'ok', items };
  } catch (error) {
    captureError(error, { area: 'candidate.getLatestMessages' });
    return { status: 'error' };
  }
}
