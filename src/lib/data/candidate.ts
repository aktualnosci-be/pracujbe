/**
 * Warstwa dostępu do danych panelu KANDYDATA — Pracuj.be (Etap 3).
 *
 * Strategia (spójna z `@/lib/jobs`): gdy `isPortalDataConfigured()` — dane czytane są z bazy
 * POD SESJĄ użytkownika (`withPortalTransaction`: `SET LOCAL ROLE authenticated` +
 * `app.current_uid` z sesji serwera, RLS wg `auth.uid()`, #25); bez env — te same struktury
 * wypełnione danymi DEMO (build i UX działają bez backendu).
 *
 * Odczyt idzie WYŁĄCZNIE przez transakcję sesji (nie service_role). Publiczne dane oferty
 * (tytuł/firma/miasto) nie są dostępne kandydatowi wprost z tabel `jobs`/`companies`
 * (P1-01: anon/authenticated-niebędący-członkiem nie czyta tabel bazowych), dlatego
 * wzbogacamy je przez RPC `get_public_jobs` (bezpieczne kolumny) i łączymy po `job_id`.
 *
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do kanału błędów
 * i degradujemy do bezpiecznej struktury, a nie do danych DEMO. Odczyty profilu
 * oznaczają awarię osobnym `loadFailed`, aby nie udawać 0% kompletności.
 */

import { cache } from 'react';

import type { PortalIdentity } from '@/lib/auth/session';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { attempt, queryCount, queryOne, queryRows, rpc, rpcRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/error-report';
import { routing, type Locale } from '@/i18n/routing';
import { demoCompanies, resolveDemoJobs } from '@/lib/data/demo';
import { findLatestActiveProposal } from '@/lib/candidate-offers';
import { customOfferMessage } from '@/lib/offers/default-message';
import { parseScreeningAnswers, type ScreeningAnswer } from '@/lib/screening/questions';
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
  /**
   * Liczba zapisanych odpowiedzi na pytania screeningowe (#101). > 0 = karta pokazuje
   * przycisk „Moje odpowiedzi”; treść wczytuje osobno `getMyApplicationScreeningAnswers`.
   */
  screeningCount: number;
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
 * Wspólne zapytania (ścieżka bazodanowa, transakcja sesji `tx`)
 * ------------------------------------------------------------------------- */

interface PublicJobLite {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  city: string;
}

/**
 * Liczba konwersacji z nieprzeczytanymi wiadomościami (model `conversation_members.last_read_at`,
 * spójny z `messages.getUnreadConversationsCount`). NIE liczymy po `messages.read_at` — ta kolumna
 * nie jest ustawiana, więc licznik po niej byłby zawyżony. Nieprzeczytana = istnieje nieusunięta
 * wiadomość od innej osoby nowsza niż własne `last_read_at` (albo nic jeszcze nie przeczytano).
 */
async function countUnreadConversations(tx: TransactionQuery, userId: string): Promise<number> {
  return queryCount(tx, 'candidate.unread-conversations',
    `SELECT 1
       FROM public.conversation_members cm
      WHERE cm.profile_id = $1
        AND EXISTS (
          SELECT 1 FROM public.messages m
           WHERE m.conversation_id = cm.conversation_id
             AND m.deleted_at IS NULL
             AND m.sender_id IS DISTINCT FROM $1
             AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at))`, [userId]);
}

function toPublicJobsMap(rows: unknown, idField: 'id' | 'job_id'): Map<string, PublicJobLite> {
  const map = new Map<string, PublicJobLite>();
  for (const row of asArr(rows)) {
    const r = asRecord(row);
    const id = asStr(r[idField]);
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

/** Mapa job_id → bezpieczne dane publiczne najnowszych ofert (RPC `get_public_jobs`). */
async function fetchPublicJobsMap(
  tx: TransactionQuery,
  locale: Locale,
  limit: number,
): Promise<Map<string, PublicJobLite>> {
  const rows = await rpcRows(tx, 'get_public_jobs', {
    p_locale: locale,
    p_keyword: null,
    p_city: null,
    p_limit: limit,
    p_offset: 0,
  });
  return toPublicJobsMap(rows, 'id');
}

/**
 * Mapa job_id → bezpieczne dane oferty dla WŁASNYCH aplikacji kandydata (RPC
 * `get_applied_jobs_display`, 0023). W odróżnieniu od `fetchPublicJobsMap` zwraca też
 * oferty nieaktywne/wygasłe/spoza top-N — kandydat ma prawo widzieć ofertę, do której
 * aplikował. `jobIds` (#184) zawęża wynik w bazie do ofert, których dotyczy odczyt.
 */
async function fetchAppliedJobsMap(
  tx: TransactionQuery,
  locale: Locale,
  jobIds: string[],
): Promise<Map<string, PublicJobLite>> {
  const ids = [...new Set(jobIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Map();
  return toPublicJobsMap(
    await rpcRows(tx, 'get_applied_jobs_display', { p_locale: locale, p_job_ids: ids }),
    'job_id',
  );
}

/**
 * Mapa job_id → dane oferty dla WŁASNYCH propozycji kandydata (RPC `get_offered_jobs_display`,
 * 0090). Jak `fetchAppliedJobsMap`: niezależnie od statusu oferty, top-N listy i blokad firm (#97)
 * — historia propozycji zachowuje tytuł i firmę.
 */
async function fetchOfferedJobsMap(tx: TransactionQuery, locale: Locale): Promise<Map<string, PublicJobLite>> {
  return toPublicJobsMap(await rpcRows(tx, 'get_offered_jobs_display', { p_locale: locale }), 'job_id');
}

/**
 * Metadane ofert tylko dla `job_id` jednej strony historii zgłoszeń (#184). Parametr
 * `p_job_ids` zawęża wynik WEWNĄTRZ RPC (0113), więc baza nie liczy całej historii, a „Pokaż
 * więcej” nie przesyła jej danych. RPC zwraca wyłącznie oferty własnych aplikacji
 * (auth.uid()), dlatego cudze lub niepowiązane `job_id` nie dają żadnego wiersza.
 */
async function fetchAppliedJobsForPage(
  tx: TransactionQuery,
  locale: Locale,
  jobIds: string[],
): Promise<Map<string, PublicJobLite>> {
  const ids = [...new Set(jobIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Map();
  const rows = await queryRows(tx, 'candidate.applied-jobs-page',
    `SELECT d.job_id, d.slug, d.title, d.company_name, d.city
       FROM public.get_applied_jobs_display(p_locale => $1, p_job_ids => $2::uuid[]) d`, [locale, ids]);
  return toPublicJobsMap(rows, 'job_id');
}

/** Zbiór job_id zapisanych przez kandydata. */
async function fetchSavedJobIds(tx: TransactionQuery, userId: string): Promise<Set<string>> {
  const rows = await queryRows(tx, 'candidate.saved-job-ids',
    'SELECT job_id FROM public.saved_jobs WHERE candidate_id = $1', [userId]);
  const set = new Set<string>();
  for (const row of rows) {
    const jobId = asStr(asRecord(row)['job_id']);
    if (jobId) set.add(jobId);
  }
  return set;
}

/** Liczy kompletność profilu + checklistę + imię (jedno źródło dla overview i summary). */
async function computeProfileSummary(
  tx: TransactionQuery,
  userId: string,
): Promise<CandidateProfileSummary> {
  const profile = asRecord(await queryOne(tx, 'candidate.profile-name',
    'SELECT first_name, last_name FROM public.profiles WHERE id = $1', [userId]));
  // Liczniki relacji (języki/certyfikaty) w tym samym wierszu profilu kandydata — brak
  // profilu kandydata = zera, jak dotąd.
  const cp = asRecord(await queryOne(tx, 'candidate.profile-completeness',
    `SELECT cp.id, cp.experience_years, cp.occupations, cp.categories, cp.city, cp.availability,
            (SELECT count(*)::integer FROM public.candidate_languages l
              WHERE l.candidate_profile_id = cp.id) AS languages_count,
            (SELECT count(*)::integer FROM public.candidate_certificates c
              WHERE c.candidate_profile_id = cp.id) AS certificates_count
       FROM public.candidate_profiles cp
      WHERE cp.profile_id = $1`, [userId]));

  // Kryteria = kroki kreatora; ta sama definicja co na profilu i w linkach „Dodaj" (#315).
  const checklist = computeProfileChecklist({
    firstName: asStr(profile['first_name']) || null,
    lastName: asStr(profile['last_name']) || null,
    occupationsCount: asStrArrLen(cp['occupations']),
    categoriesCount: asStrArrLen(cp['categories']),
    experienceYears: cp['experience_years'],
    city: asStr(cp['city']) || null,
    languagesCount: asNum(cp['languages_count']),
    certificatesCount: asNum(cp['certificates_count']),
    availability: asStr(cp['availability']) || null,
  });

  const completionPct = completionPctOf(checklist);
  const firstName = asStr(profile['first_name']) || null;

  return { loadFailed: false, firstName, completionPct, checklist };
}

/**
 * Podsumowanie profilu we własnej transakcji sesji. `cache()` per-request (klucz = obiekt
 * tożsamości z `getPortalIdentity`, też memoizowany per żądanie) — gdy overview i summary
 * renderują się w tym samym żądaniu, komplet zapytań profilu wykona się tylko raz.
 */
const loadProfileSummary = cache((me: PortalIdentity): Promise<CandidateProfileSummary> =>
  withPortalTransaction(me, (tx) => computeProfileSummary(tx, me.id)));

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
      screeningCount: DEMO_SCREENING_ANSWERS[`demo-app-${index}`]?.length ?? 0,
    };
  });
}

/**
 * Odpowiedzi DEMO (#101) — snapshot jak w `application_screening_answers`: treść w języku
 * oferty (PL) i tłumaczenia; pytanie bez odpowiedzi pokazuje „Brak odpowiedzi”.
 */
const DEMO_SCREENING_ANSWERS: Record<string, ScreeningAnswer[]> = {
  'demo-app-0': [
    { position: 0, type: 'yes_no', required: true, prompt: { pl: 'Czy masz prawo jazdy kat. B?', nl: 'Heb je een rijbewijs B?', fr: 'Avez-vous le permis B ?', en: 'Do you hold a category B driving licence?' }, options: [], answerBoolean: true, answerDate: null, answerText: null },
    { position: 1, type: 'single_choice', required: true, prompt: { pl: 'Na którą zmianę możesz pracować?', nl: 'Welke ploeg kun je werken?', fr: 'Quelle équipe pouvez-vous faire ?', en: 'Which shift can you work?' }, options: [{ id: 'o1', label: { pl: 'Dzienna', nl: 'Dagploeg', fr: 'Jour', en: 'Day shift' } }, { id: 'o2', label: { pl: 'Nocna', nl: 'Nachtploeg', fr: 'Nuit', en: 'Night shift' } }], answerBoolean: null, answerDate: null, answerText: 'o2' },
    { position: 2, type: 'date', required: false, prompt: { pl: 'Od kiedy możesz zacząć?', nl: 'Vanaf wanneer kun je beginnen?', fr: 'À partir de quand pouvez-vous commencer ?', en: 'When can you start?' }, options: [], answerBoolean: null, answerDate: '2026-10-05', answerText: null },
    { position: 3, type: 'short_text', required: false, prompt: { pl: 'Opisz krótko doświadczenie na magazynie', nl: 'Beschrijf kort je magazijnervaring', fr: 'Décrivez brièvement votre expérience en entrepôt', en: 'Briefly describe your warehouse experience' }, options: [], answerBoolean: null, answerDate: null, answerText: null },
  ],
};

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
  if (!isPortalDataConfigured()) {
    if (isDashboardErrorFixture()) {
      return { newJobsCount: null, activeApplicationsCount: null, unreadMessagesCount: null, profileCompletionPct: 0 };
    }
    return DEMO_OVERVIEW;
  }

  try {
    const me = await getPortalIdentity();
    if (!me) {
      return { newJobsCount: 0, activeApplicationsCount: 0, unreadMessagesCount: 0, profileCompletionPct: 0 };
    }

    // Każdy licznik w osobnej sekcji (SAVEPOINT, sekwencyjnie): awaria jednego daje `null`
    // tylko dla niego; pozostałe zachowują prawdziwe wartości (#244).
    const counters = await withPortalTransaction(me, async (tx) => {
      const newJobs = await attempt(tx, async () =>
        asNum(await rpc(tx, 'get_public_jobs_count', { p_keyword: null, p_city: null })));
      const activeApplications = await attempt(tx, () => queryCount(tx, 'candidate.active-applications',
        `SELECT 1 FROM public.applications
          WHERE candidate_id = $1 AND deleted_at IS NULL AND status::text = ANY($2::text[])`,
        [me.id, [...ACTIVE_APPLICATION_STATUSES]]));
      const unreadMessages = await attempt(tx, () => countUnreadConversations(tx, me.id));
      return { newJobs, activeApplications, unreadMessages };
    });
    const settled = (area: string, result: typeof counters.newJobs): number | null => {
      if (result.ok) return result.value;
      captureError(result.error, { area: `candidate.getCandidateOverview.${area}` });
      return null;
    };

    const profile = await loadProfileSummary(me).catch((error: unknown) => {
      captureError(error, { area: 'candidate.getCandidateOverview.profileSummary' });
      return FAILED_PROFILE_SUMMARY;
    });

    return {
      newJobsCount: settled('newJobs', counters.newJobs),
      activeApplicationsCount: settled('activeApplications', counters.activeApplications),
      unreadMessagesCount: settled('unreadMessages', counters.unreadMessages),
      profileCompletionPct: profile.completionPct,
    };
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateOverview' });
    return { newJobsCount: null, activeApplicationsCount: null, unreadMessagesCount: null, profileCompletionPct: 0 };
  }
}

/** Imię + kompletność profilu (pierścień) + checklista sekcji. */
export async function getCandidateProfileSummary(): Promise<CandidateProfileSummary> {
  if (!isPortalDataConfigured()) return DEMO_PROFILE_SUMMARY;

  try {
    const me = await getPortalIdentity();
    if (!me) return DEMO_PROFILE_SUMMARY;
    return await loadProfileSummary(me);
  } catch (error) {
    captureError(error, { area: 'candidate.getCandidateProfileSummary' });
    return FAILED_PROFILE_SUMMARY;
  }
}

/** Własny paszport zawodowy; przy błędzie nie podstawiamy fikcyjnych danych demonstracyjnych. */
export async function getCandidatePassport(): Promise<CandidatePassport> {
  if (!isPortalDataConfigured()) return EMPTY_PASSPORT;

  try {
    const me = await getPortalIdentity();
    if (!me) return EMPTY_PASSPORT;

    // Profil i jego relacje jednym zapytaniem pod RLS (właściciel profilu).
    const data = await withPortalTransaction(me, (tx) => queryOne(tx, 'candidate.passport',
      `SELECT cp.occupations, cp.city, cp.radius_km, cp.experience_years, cp.availability,
              (SELECT coalesce(json_agg(s.skill_label), '[]'::json) FROM public.candidate_skills s
                WHERE s.candidate_profile_id = cp.id) AS skills,
              (SELECT coalesce(json_agg(l.language_label), '[]'::json) FROM public.candidate_languages l
                WHERE l.candidate_profile_id = cp.id) AS languages,
              (SELECT coalesce(json_agg(c.certificate_label), '[]'::json) FROM public.candidate_certificates c
                WHERE c.candidate_profile_id = cp.id) AS certificates
         FROM public.candidate_profiles cp
        WHERE cp.profile_id = $1 AND cp.deleted_at IS NULL`, [me.id]));
    if (!data) return EMPTY_PASSPORT;

    const profile = asRecord(data);
    const labels = (value: unknown): string[] => asArr(value)
      .map((label) => asStr(label).trim())
      .filter(Boolean);
    return {
      loadFailed: false,
      occupations: asArr(profile['occupations']).filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      city: asStr(profile['city']) || null,
      radiusKm: typeof profile['radius_km'] === 'number' ? profile['radius_km'] : null,
      experienceYears: typeof profile['experience_years'] === 'number' ? profile['experience_years'] : null,
      availability: asStr(profile['availability']) || null,
      skills: labels(profile['skills']),
      languages: labels(profile['languages']),
      certificates: labels(profile['certificates']),
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
  tx: TransactionQuery,
  locale: Locale,
  ids: string[],
): Promise<Map<string, PublicJobLite>> {
  if (ids.length === 0) return new Map();
  return toPublicJobsMap(await rpcRows(tx, 'get_public_jobs_by_ids', { p_ids: ids, p_locale: locale }), 'id');
}

/**
 * Polecane oferty: najlepsze `matches` kandydata (score desc, job_id jako rozstrzygnięcie),
 * wzbogacone o dane publiczne dokładnie tych ofert — niezależnie od ich wieku (#196).
 * Fallback = najnowsze oferty, tylko gdy żadne dopasowanie nie jest już publiczne.
 */
export async function getRecommendedJobs(locale: string, throwOnError = false): Promise<RecommendedJob[]> {
  const resolvedLocale = toLocale(locale);
  if (!isPortalDataConfigured()) return demoRecommended(resolvedLocale);

  try {
    const me = await getPortalIdentity();
    if (!me) return [];

    return await withPortalTransaction(me, async (tx) => {
      const matchRows = (await queryRows(tx, 'candidate.recommended-matches',
        `SELECT job_id, score FROM public.matches
          WHERE candidate_id = $1
          ORDER BY score DESC, job_id ASC
          LIMIT $2`, [me.id, RECOMMENDED_MATCHES_LIMIT])).map((row) => {
        const r = asRecord(row);
        return { jobId: asStr(r['job_id']), score: asNum(r['score']) };
      }).filter((row) => row.jobId.length > 0);
      const savedIds = await fetchSavedJobIds(tx, me.id);
      const jobsById = await fetchPublicJobsByIds(tx, resolvedLocale, [...new Set(matchRows.map((row) => row.jobId))]);

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

      const jobsMap = await fetchPublicJobsMap(tx, resolvedLocale, PUBLIC_JOBS_LOOKUP_LIMIT);
      // 2) Fallback: najnowsze oferty publiczne (bez policzonego matchu). Przepuszczamy je przez
      // RPC po ID, które pod sesją pomija oferty firm zablokowanych przez kandydata (#97).
      const allowed = await fetchPublicJobsByIds(tx, resolvedLocale, [...jobsMap.keys()].slice(0, 100));
      const latest: RecommendedJob[] = [];
      for (const job of jobsMap.values()) {
        if (!allowed.has(job.id)) continue;
        latest.push({ ...job, match: null, saved: savedIds.has(job.id) });
        if (latest.length >= RECOMMENDED_LIMIT) break;
      }
      return latest;
    });
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
  if (!isPortalDataConfigured()) {
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
    const me = await getPortalIdentity();
    if (!me) return { items: [], nextCursor: null };

    return await withPortalTransaction(me, async (tx) => {
      // Kursor (czas + UUID) jako porównanie krotek: starsze zgłoszenie albo ten sam czas
      // i mniejszy UUID. Kursor z Server Action jest sprawdzany przez Zod przed trafieniem tutaj.
      const rows = await queryRows(tx, 'candidate.applications-page',
        `SELECT id, job_id, status, submitted_at,
                (SELECT count(*)::int FROM public.application_screening_answers s
                  WHERE s.application_id = applications.id) AS screening_count
           FROM public.applications
          WHERE candidate_id = $1
            AND deleted_at IS NULL
            AND ($2::timestamptz IS NULL OR (submitted_at, id) < ($2::timestamptz, $3::uuid))
          ORDER BY submitted_at DESC, id DESC
          LIMIT $4`,
        [me.id, cursor?.submittedAt ?? null, cursor?.id ?? null, APPLICATION_PAGE_SIZE + 1]);

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
        tx,
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
          screeningCount: Number(r['screening_count'] ?? 0) || 0,
        };
      });
      return { items, nextCursor };
    });
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
      screeningCount: 0,
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
    // getMyApplicationsPage zgłosił już błąd do kanału błędów.
    return { status: 'error' };
  }
}

/**
 * Pytania screeningowe i odpowiedzi WŁASNEGO zgłoszenia (#101) — niezmienny snapshot
 * z `application_screening_answers` (treść pytań i opcji z chwili wysłania, nie z bieżącej
 * oferty). Odczyt pod sesją: polityka `application_screening_answers_select` (0093) wpuszcza
 * kandydata tylko do jego zgłoszeń; warunek `candidate_id` w zapytaniu to ten sam zakres
 * powtórzony jawnie. Cudze albo nieistniejące zgłoszenie = pusta lista. Błąd bazy → wyjątek
 * (ekran pokazuje błąd z ponowieniem, nie „brak pytań”).
 */
const ANSWERS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getMyApplicationScreeningAnswers(applicationId: string): Promise<ScreeningAnswer[]> {
  if (!isPortalDataConfigured()) return DEMO_SCREENING_ANSWERS[applicationId] ?? [];
  if (!ANSWERS_UUID_RE.test(applicationId)) return [];

  try {
    const me = await getPortalIdentity();
    if (!me) return [];
    const rows = await withPortalTransaction(me, (tx) => queryRows(tx, 'candidate.application-screening-answers',
      `SELECT s.position, s.type, s.required, s.prompt, s.options, s.answer_boolean, s.answer_date, s.answer_text
         FROM public.application_screening_answers s
         JOIN public.applications a ON a.id = s.application_id
        WHERE s.application_id = $1 AND a.candidate_id = $2 AND a.deleted_at IS NULL
        ORDER BY s.position`, [applicationId, me.id]));
    return parseScreeningAnswers(rows);
  } catch (error) {
    captureError(error, { area: 'candidate.getMyApplicationScreeningAnswers' });
    throw error;
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
  if (!isPortalDataConfigured()) return { status: 'ready', jobs: demoSaved(resolvedLocale) };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };

    const data = await withPortalTransaction(me, (tx) =>
      rpcRows(tx, 'get_saved_jobs_display', { p_locale: resolvedLocale }));
    const jobs = data.map((row): RecommendedJob => {
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
  if (!isPortalDataConfigured()) {
    // Test przeglądarkowy uruchamia osobny serwer Next dev. Ta gałąź nie działa w buildzie produkcyjnym.
    if (process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full') {
      return developmentOfferFixture(resolvedLocale, cursor);
    }
    return { items: cursor ? [] : demoOffers(resolvedLocale), nextCursor: null };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { items: [], nextCursor: null };

    return await withPortalTransaction(me, async (tx) => {
      // Kursor (czas + UUID) jako porównanie krotek; sprawdzony przez Zod w Server Action.
      const rows = await queryRows(tx, 'candidate.offers-page',
        `SELECT id, job_id, status, message, sent_at, created_at, expires_at
           FROM public.offers
          WHERE candidate_id = $1
            AND deleted_at IS NULL
            AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT $4`,
        [me.id, cursor?.createdAt ?? null, cursor?.id ?? null, OFFER_PAGE_SIZE + 1]);

      if (rows.length === 0) return { items: [], nextCursor: null };
      const visibleRows = rows.slice(0, OFFER_PAGE_SIZE);
      const last = asRecord(visibleRows[visibleRows.length - 1]);
      const nextCursor = rows.length > OFFER_PAGE_SIZE
        ? { createdAt: asStr(last['created_at']), id: asStr(last['id']) }
        : null;

      const appliedMap = await fetchAppliedJobsMap(
        tx,
        resolvedLocale,
        visibleRows.map((row) => asStr(asRecord(row)['job_id'])),
      );
      const offeredMap = await fetchOfferedJobsMap(tx, resolvedLocale);

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
    });
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
  if (!isPortalDataConfigured()) return latestDemoOffer(resolvedLocale);

  try {
    const me = await getPortalIdentity();
    if (!me) return null;

    return await withPortalTransaction(me, async (tx) => {
      const data = await queryOne(tx, 'candidate.latest-active-offer',
        `SELECT id, job_id, status, message, sent_at, expires_at
           FROM public.offers
          WHERE candidate_id = $1
            AND deleted_at IS NULL
            AND status IN ('sent', 'viewed')
            AND sent_at IS NOT NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY sent_at DESC, id DESC
          LIMIT 1`, [me.id]);
      if (!data) return null;

      const row = asRecord(data);
      const jobId = asStr(row['job_id']);
      const appliedMap = await fetchAppliedJobsMap(tx, resolvedLocale, [jobId]);
      const job = appliedMap.get(jobId) ?? (await fetchOfferedJobsMap(tx, resolvedLocale)).get(jobId);

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
    });
  } catch (error) {
    captureError(error, { area: 'candidate.getLatestActiveOffer' });
    return null;
  }
}

/** Ostatnie wiadomości/konwersacje kandydata. Pusta lista tylko po udanym odczycie (#244). */
export async function getLatestMessages(): Promise<CandidateSectionLoad<LatestMessage>> {
  if (!isPortalDataConfigured()) {
    if (isDashboardErrorFixture()) return { status: 'error' };
    return { status: 'ok', items: demoMessages(routing.defaultLocale) };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'ok', items: [] };

    // Trzy najnowsze własne rozmowy (RLS: członek rozmowy) z ostatnią nieusuniętą wiadomością;
    // „nieprzeczytana” = ostatnia wiadomość od innej osoby, nowsza niż własne last_read_at.
    const convs = await withPortalTransaction(me, (tx) => queryRows(tx, 'candidate.latest-messages',
      `SELECT c.id, c.subject, c.last_message_at,
              lm.body AS last_body, lm.created_at AS last_created_at,
              coalesce(lm.sender_id IS DISTINCT FROM $1
                AND (cm.last_read_at IS NULL OR lm.created_at > cm.last_read_at), false) AS unread
         FROM public.conversation_members cm
         JOIN public.conversations c ON c.id = cm.conversation_id
         LEFT JOIN LATERAL (
           SELECT m.body, m.sender_id, m.created_at
             FROM public.messages m
            WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
         ) lm ON true
        WHERE cm.profile_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
        LIMIT 3`, [me.id]));

    const items = convs.map((c): LatestMessage => {
      const r = asRecord(c);
      return {
        id: asStr(r['id']),
        title: asStr(r['subject']),
        preview: asStr(r['last_body']),
        time: asStr(r['last_created_at']) || asStr(r['last_message_at']),
        unread: r['unread'] === true,
      };
    });
    return { status: 'ok', items };
  } catch (error) {
    captureError(error, { area: 'candidate.getLatestMessages' });
    return { status: 'error' };
  }
}
