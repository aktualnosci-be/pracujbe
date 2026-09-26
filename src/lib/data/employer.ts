/**
 * Warstwa danych panelu pracodawcy — Pracuj.be (Etap 4).
 *
 * Strategia (#25): gdy `isPortalDataConfigured()` — dane czytane są z PostgreSQL pod SESJĄ
 * zalogowanego użytkownika (`withPortalTransaction`: rola `authenticated` + `app.current_uid`,
 * RLS decyduje w bazie; NIGDY service-role). Bez konfiguracji (build/preview bez env) zwracamy
 * te same struktury z danymi DEMO, dzięki czemu panel renderuje się bez zmiennych środowiskowych
 * (Invariant: brak degradacji skonfigurowanej bazy do danych demonstracyjnych — w trybie DB
 * zwracamy dane realne lub puste).
 *
 * „Aktywna firma" wyznaczana jest przez `getActiveCompany` (cookie zwalidowane względem
 * aktywnych członkostw, FUN-07) — panel pokazuje dane wyłącznie tej firmy (RLS pilnuje
 * izolacji firma A / firma B). Każdy loader to jedna transakcja; loadery wołane równolegle
 * przez stronę mają osobne transakcje, więc każda sekcja pulpitu zawodzi niezależnie.
 */

import { cache } from 'react';

import type { PortalIdentity } from '@/lib/auth/session';
import { getActiveCompany } from '@/lib/company-context';
import { isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { attempt, queryCount, queryOne, queryRows, rpcRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { effectiveJobStatus, isPastExpiry } from '@/lib/job-expiry';
import {
  encodeScoreCursor,
  encodeTimeCursor,
  toListPage,
  type ListPage,
  type ListPageRequest,
  type ScoreCursor,
  type TimeCursor,
} from '@/lib/employer/list-cursor';
import { canRecruit } from '@/lib/team/permissions';
import { captureError } from '@/lib/error-report';
import {
  parseScreeningAnswers,
  parseScreeningQuestions,
  type ScreeningAnswer,
  type ScreeningQuestionDraft,
} from '@/lib/screening/questions';
import {
  DEFAULT_FUNNEL_RANGE,
  funnelDateRange,
  type FunnelDateRange,
  type FunnelRangeDays,
} from '@/lib/job-funnel/range';

/* ---------------------------------------------------------------------------
 * Kontrakt (typy zwracane do UI)
 * ------------------------------------------------------------------------- */

/**
 * Kafelki przeglądowe. `null` = „brak danych” (nie zero): liczniki zgłoszeń, dopasowań
 * i rozmów czyta wyłącznie recruiter+ (RLS 0039 — zwykły `member` dostałby z bazy 0, które
 * udawałoby brak aktywności); dopasowani kandydaci są dostępni dopiero dla zweryfikowanej firmy.
 */
export interface EmployerOverview {
  activeOffersCount: number;
  /** Zgłoszenia w statusie `submitted` (jeszcze nieprzejrzane). */
  newApplicationsCount: number | null;
  /** RÓŻNI kandydaci dopasowani do ofert firmy (nie wiersze `matches`) — jak lista „Top dopasowani”. */
  matchedCandidatesCount: number | null;
  /** Rozmowy AKTYWNEJ firmy, w których ostatnia wiadomość jest od kandydata (czekają na odpowiedź). */
  messagesToAnswerCount: number | null;
  /** Rola recruiter+ w aktywnej firmie — gdy `false`, UI wyjaśnia, dlaczego liczników brak. */
  recruiterAccess: boolean;
  /** Firma zweryfikowana — gdy `false`, dopasowani kandydaci czekają na weryfikację. */
  companyVerified: boolean;
}

export interface EmployerJob {
  id: string;
  title: string;
  city: string;
  /**
   * Status efektywny (draft/active/paused/closed/expired) — mapowany w StatusPill. Aktywna po
   * `expires_at` jest pokazywana jako `expired`, zanim maintenance zmieni rekord (#72).
   */
  status: string;
  /** Data ważności minęła — wstrzymana po terminie proponuje ponowne otwarcie zamiast wznowienia. */
  pastExpiry: boolean;
  /** Publiczny adres oferty (link „Zobacz ofertę" dla aktywnej, #325). */
  slug: string;
  /** `null` = brak uprawnień rekrutera do zgłoszeń (nie zero). */
  newApplications: number | null;
  /** `null` = brak uprawnień rekrutera do dopasowań (nie zero). */
  matched: number | null;
  /** Data utworzenia (ISO) — pokazywana zamiast technicznego identyfikatora (Invariant #8). */
  createdAt: string | null;
}

export interface EmployerApplication {
  id: string;
  candidateName: string;
  jobTitle: string;
  /** Surowy `application_status` — mapowany w StatusPill. */
  status: string;
  /** #98: aplikacja bez konta (candidate_id NULL, snapshot imienia i e-maila). */
  isGuest?: boolean;
}

/** Imię kandydata z profilu, a dla aplikacji bez konta (#98) — ze snapshotu `guest_name`. */
function applicationCandidate(row: Record<string, unknown>): { candidateName: string; isGuest?: true } {
  // CHECK 0095: candidate_id NULL ⇒ jest snapshot gościa (guest_name, guest_email).
  const guestName = asString(row['guest_name']).trim();
  const isGuest = !asString(row['candidate_id']) && guestName.length > 0;
  const profile = asEmbeddedRecord(row['profiles']);
  const name = fullName(profile['first_name'], profile['last_name']);
  return { candidateName: name || (isGuest ? guestName : ''), ...(isGuest ? { isGuest: true as const } : {}) };
}

export interface EmployerMatchedCandidate {
  candidateId: string;
  /** Oferta o najwyższym dopasowaniu do kandydata (cel wysyłki propozycji). */
  jobId: string;
  /** Tytuł tej oferty — pracodawca widzi, na które stanowisko zaprasza (#327). */
  jobTitle: string;
  /** Slug oferty do linku; pusty, gdy nieznany. */
  jobSlug: string;
  /** Data wysłania aktywnej propozycji (sent/viewed) dla pary kandydat × oferta, z DB; inaczej null. */
  offerSentAt: string | null;
  /** Imię i nazwisko, o ile widoczne przez RLS; inaczej pusty string (UI podstawia etykietę). */
  name: string;
  role: string;
  city: string;
  /** Dopasowanie w procentach (0–100). */
  match: number;
}

export interface FunnelStats {
  /**
   * Wyświetlenia szczegółów ofert w okresie lejka — serwerowy agregat bez śledzenia (#99).
   * `null` = brak danych (np. brak uprawnień rekrutera): UI pokazuje „brak danych"
   * i pomija konwersję wyświetlenia → aplikacje, zamiast fałszywego 0.
   */
  views: number | null;
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
  recruiterAccess: true,
  companyVerified: true,
};

/** Delty tygodniowe do podpisów StatCard — wyłącznie w trybie DEMO (brak historii w DB path). */
export const DEMO_OVERVIEW_DELTAS = {
  activeOffers: 2,
  newApplications: 18,
  matched: 7,
  urgent: 2,
} as const;

const DEMO_JOBS: EmployerJob[] = [
  { id: '12345', title: 'Operator wózka widłowego', city: 'Liège', status: 'active', slug: '', pastExpiry: false, newApplications: 12, matched: 6, createdAt: '2026-09-18T09:00:00Z' },
  { id: '12344', title: 'Pracownik magazynu', city: 'Antwerpia', status: 'active', slug: '', pastExpiry: false, newApplications: 8, matched: 4, createdAt: '2026-09-15T09:00:00Z' },
  { id: '12343', title: 'Elektryk przemysłowy', city: 'Charleroi', status: 'active', slug: '', pastExpiry: false, newApplications: 5, matched: 3, createdAt: '2026-09-11T09:00:00Z' },
  { id: '12342', title: 'Produkcja – operator maszyn', city: 'Genk', status: 'active', slug: '', pastExpiry: false, newApplications: 7, matched: 4, createdAt: '2026-09-08T09:00:00Z' },
  { id: '12341', title: 'Specjalista ds. logistyki', city: 'Bruksela', status: 'active', slug: '', pastExpiry: false, newApplications: 3, matched: 2, createdAt: '2026-09-02T09:00:00Z' },
];

const DEMO_APPLICATIONS: EmployerApplication[] = [
  { id: 'demo-app-1', candidateName: 'Piotr Nowak', jobTitle: 'Elektryk przemysłowy', status: 'submitted' },
  { id: 'demo-app-2', candidateName: 'Katarzyna Zielińska', jobTitle: 'Operator wózka widłowego', status: 'viewed' },
  { id: 'demo-app-3', candidateName: 'Michał Wiśniewski', jobTitle: 'Pracownik magazynu', status: 'shortlisted' },
  { id: 'demo-app-4', candidateName: 'Anna Kowalczyk', jobTitle: 'Specjalista ds. logistyki', status: 'interview' },
];

const DEMO_CANDIDATES: EmployerMatchedCandidate[] = [
  { candidateId: 'demo-c-1', jobId: '12343', jobTitle: 'Elektryk przemysłowy', jobSlug: '', offerSentAt: null, name: 'Piotr Nowak', role: 'Elektryk przemysłowy', city: 'Charleroi', match: 92 },
  { candidateId: 'demo-c-2', jobId: '12345', jobTitle: 'Operator wózka widłowego', jobSlug: '', offerSentAt: null, name: 'Katarzyna Zielińska', role: 'Operator wózka widłowego', city: 'Liège', match: 88 },
  { candidateId: 'demo-c-3', jobId: '12344', jobTitle: 'Pracownik magazynu', jobSlug: '', offerSentAt: null, name: 'Michał Wiśniewski', role: 'Pracownik magazynu', city: 'Antwerpia', match: 85 },
];

const DEMO_FUNNEL: FunnelStats = { views: 4126, applications: 287, interviews: 38, hired: 6 };

const EMPTY_OVERVIEW: EmployerOverview = {
  activeOffersCount: 0,
  newApplicationsCount: 0,
  matchedCandidatesCount: 0,
  messagesToAnswerCount: 0,
  recruiterAccess: true,
  companyVerified: true,
};

const EMPTY_FUNNEL: FunnelStats = { views: null, applications: 0, interviews: 0, hired: 0 };

/** Okno czasowe lejka — musi odpowiadać etykiecie `dashboard.funnelPeriod` („ostatnie 30 dni"). */
export const FUNNEL_PERIOD_DAYS = 30;

/** Jawny stan odczytu kafelków — błąd bazy nie może udawać zer (#304). */
export type EmployerOverviewLoad =
  | { status: 'ok'; overview: EmployerOverview }
  | { status: 'error' };

/**
 * Jawny stan odczytu lejka — błąd bazy nie może udawać pustego lejka (#304), a brak uprawnień
 * rekrutera (zwykły `member`: RLS ukrywa zgłoszenia) nie może udawać lejka z zerami.
 */
export type FunnelStatsLoad =
  | { status: 'ok'; funnel: FunnelStats }
  | { status: 'denied' }
  | { status: 'error' };

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
 * Pomocnicze parsowanie (wiersze JSON z bazy → `unknown`)
 * ------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Osadzony rekord (`to_json` podzapytania) bywa obiektem, null albo tablicą — normalizujemy. */
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
  me: PortalIdentity;
  companyId: string;
  companyStatus: string;
  /** Rola w aktywnej firmie — decyduje, czy liczniki rekrutacyjne są dostępne (recruiter+). */
  role: string;
}

/**
 * Kontekst pracodawcy (sesja + aktywna firma) rozwiązywany RAZ na żądanie.
 * `cache()` (React) memoizuje wynik per-request — wołany przez wszystkie loadery panelu
 * (~5×/żądanie) czyta sesję i `company_members` tylko jeden raz. Same dane loadery czytają
 * we własnych transakcjach pod tą samą sesją (RLS nadal sprawdza członkostwo w bazie).
 */
const loadContext = cache(async (): Promise<EmployerContext | null> => {
  const me = await getPortalIdentity();
  if (!me) return null;

  // AKTYWNA firma z kontekstu (cookie-aware, zwalidowana — FUN-07), nie „pierwsze członkostwo".
  const ctx = await withPortalTransaction(me, (tx) => getActiveCompany(tx, me.id));
  if (!ctx.activeId) return null;

  return { me, companyId: ctx.activeId, companyStatus: ctx.activeStatus, role: ctx.activeRole };
});

/** Kolumny listy zgłoszeń: imię kandydata i tytuł oferty jako osadzone rekordy (pod RLS). */
const APPLICATION_LIST_COLUMNS = `a.id, a.status, a.candidate_id, a.guest_name,
       (SELECT to_json(p) FROM (SELECT pr.first_name, pr.last_name FROM public.profiles pr
                                 WHERE pr.id = a.candidate_id) p) AS profiles,
       (SELECT to_json(j) FROM (SELECT jb.title FROM public.jobs jb
                                 WHERE jb.id = a.job_id) j) AS jobs`;

/**
 * Dane do chrome panelu pracodawcy (FUN-07/FUN-13): lista firm użytkownika + aktywna firma
 * (z jej statusem weryfikacji) + dane użytkownika.
 *
 * Wynik jest jawny (#401): `demo` tylko bez env; `error` przy każdej awarii odczytu — UI
 * pokazuje wtedy neutralną etykietę i ponowienie, NIGDY nazwę firmy demonstracyjnej jako
 * realną. `cache()` — layout i strony panelu dzielą jeden odczyt na żądanie.
 */
export type EmployerShellData =
  | { status: 'demo' }
  | {
      status: 'ok';
      companies: { id: string; name: string; role: string }[];
      activeId: string | null;
      activeName: string;
      activeRole: string;
      /** Surowy `company_status` aktywnej firmy. */
      activeStatus: string;
      userName: string;
    }
  | { status: 'error' };

export const getEmployerShellData = cache(async (): Promise<EmployerShellData> => {
  if (!isPortalDataConfigured()) return { status: 'demo' };
  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };

    const { ctx, profileRow } = await withPortalTransaction(me, async (tx) => {
      const ctx = await getActiveCompany(tx, me.id);
      // Brak imienia/nazwiska (lub chwilowy błąd profilu) → neutralna etykieta w UI, nie błąd panelu.
      const profile = await attempt(tx, () =>
        queryOne(tx, 'employer.shell-profile',
          'SELECT first_name, last_name FROM public.profiles WHERE id = $1', [me.id]));
      return { ctx, profileRow: profile.ok ? profile.value : null };
    });
    const p = asRecord(profileRow);
    const userName = [asString(p['first_name']), asString(p['last_name'])]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');

    return {
      status: 'ok',
      companies: ctx.companies.map((c) => ({ id: c.id, name: c.name, role: c.role })),
      activeId: ctx.activeId,
      activeName: ctx.activeName,
      activeRole: ctx.activeRole,
      activeStatus: ctx.activeStatus,
      userName,
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerShellData' });
    return { status: 'error' };
  }
});

/* ---------------------------------------------------------------------------
 * Publiczne API panelu pracodawcy
 * ------------------------------------------------------------------------- */

/**
 * Dopasowani kandydaci firmy: RÓŻNI kandydaci (kandydat dopasowany do trzech ofert liczy się raz),
 * te same warunki co lista `get_company_top_matches` (0079) — nieusunięta oferta firmy, kandydat
 * widoczny pod RLS, firma zweryfikowana. RLS `matches` dokłada recruiter+, blokadę firmy (#97)
 * i widoczność profilu (#494).
 */
const MATCHED_CANDIDATES_SQL = `SELECT DISTINCT m.candidate_id
     FROM public.matches m
     JOIN public.jobs j ON j.id = m.job_id
    WHERE j.company_id = $1 AND j.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.candidate_profiles cp WHERE cp.profile_id = m.candidate_id)`;

/**
 * Rozmowy aktywnej firmy czekające na odpowiedź: ostatnia (nieusunięta) wiadomość wysłał ktoś
 * spoza firmy, czyli kandydat. Liczone per FIRMA, nie per użytkownik — wcześniejszy licznik
 * nieprzeczytanych powiadomień `message_received` obejmował też rozmowy innych firm użytkownika
 * i gasł po otwarciu powiadomienia, choć nikt nie odpisał. Członek firmy (także byłego zespołu,
 * `is_active = false`) to strona firmowa — jego wiadomość jest odpowiedzią. Odczyt pod RLS
 * (`is_conversation_member`, 0039): rozmowy firmy, których użytkownik jest uczestnikiem.
 */
const CONVERSATIONS_AWAITING_REPLY_SQL = `SELECT 1
     FROM public.conversations c
     JOIN LATERAL (
       SELECT m.sender_id FROM public.messages m
        WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
     ) last ON true
    WHERE c.company_id = $1 AND c.deleted_at IS NULL
      AND last.sender_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.company_members cm
                       WHERE cm.company_id = $1 AND cm.profile_id = last.sender_id)`;

/**
 * Kafelki statystyk (aktywne oferty, nowe aplikacje, dopasowani, wiadomości do odpowiedzi).
 * Liczniki rekrutacyjne tylko dla recruiter+ — dla zwykłego `member` `null` („brak danych”),
 * bo RLS zwróciłby 0 udające brak aktywności. Dopasowani: `null` także dla firmy
 * niezweryfikowanej (dostęp do bazy kandydatów dopiero po weryfikacji).
 */
export async function getEmployerOverview(): Promise<EmployerOverviewLoad> {
  if (!isPortalDataConfigured()) return { status: 'ok', overview: DEMO_OVERVIEW };

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', overview: EMPTY_OVERVIEW };
    const { me, companyId, companyStatus, role } = ctx;
    const recruiter = canRecruit(role);

    // Liczniki w jednej transakcji: błąd któregokolwiek = stan błędu kafelków (#304).
    const overview = await withPortalTransaction(me, async (tx): Promise<EmployerOverview> => ({
      activeOffersCount: await queryCount(tx, 'employer.overview-active-jobs',
        `SELECT 1 FROM public.jobs
          WHERE company_id = $1 AND status = 'active' AND deleted_at IS NULL
            -- #72: przeterminowana oferta nie jest aktywna także przed przebiegiem maintenance.
            AND (expires_at IS NULL OR expires_at > now())`, [companyId]),
      newApplicationsCount: recruiter
        ? await queryCount(tx, 'employer.overview-new-applications',
            `SELECT 1 FROM public.applications
              WHERE company_id = $1 AND status = 'submitted' AND deleted_at IS NULL`, [companyId])
        : null,
      matchedCandidatesCount: recruiter && companyStatus === 'verified'
        ? await queryCount(tx, 'employer.overview-matched-candidates', MATCHED_CANDIDATES_SQL, [companyId])
        : null,
      messagesToAnswerCount: recruiter
        ? await queryCount(tx, 'employer.overview-awaiting-reply', CONVERSATIONS_AWAITING_REPLY_SQL, [companyId])
        : null,
      recruiterAccess: recruiter,
      companyVerified: companyStatus === 'verified',
    }));

    return { status: 'ok', overview };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerOverview' });
    return { status: 'error' };
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
  if (!isPortalDataConfigured()) return null;
  try {
    const ctx = await loadContext();
    if (!ctx) return null;
    const { me, companyId } = ctx;
    // RETURNS TABLE (0055) — jeden wiersz planu.
    const rows = await withPortalTransaction(me, (tx) =>
      rpcRows(tx, 'get_company_entitlements', { p_company_id: companyId }));
    const row = asRecord(rows[0]);
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
  /** #101: pytania screeningowe — wczytywane, bo krok 7 zapisuje je replace-all. */
  screeningQuestions: ScreeningQuestionDraft[];
}

/** Stany oferty, które kreator otwiera: szkic (zapis per krok) i opublikowana (#325, rewizja). */
export type EditableJobStatus = 'draft' | 'active' | 'paused';

/**
 * Wynik wczytania oferty do kreatora: jawnie rozdziela „brak/obcy", „nieedytowalna"
 * (zamknięta/wygasła — najpierw ponowne otwarcie) i błąd odczytu.
 */
export type JobDraftLoad =
  | {
      status: 'ok';
      jobId: string;
      jobStatus: EditableJobStatus;
      /** Publiczny adres oferty (`/oferty-pracy/[slug]`); dla szkicu techniczny `draft-…`. */
      slug: string;
      /** Wersja wczytana do kreatora — CAS przy zapisie opublikowanej oferty. */
      updatedAt: string;
      /** Język treści oferty (`default_locale`) — pytania screeningowe wymagają tekstu w nim. */
      contentLocale: string;
      values: JobDraftValues;
    }
  | { status: 'not-found' }
  | { status: 'not-editable'; jobStatus: string }
  | { status: 'error' };

function isEditableJobStatus(status: string): status is EditableJobStatus {
  return status === 'draft' || status === 'active' || status === 'paused';
}

function numToText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Tryb DEMO (brak env): aktywna oferta z listy demo otwiera kreator w trybie edycji (#325) —
 * „Edytuj" nie prowadzi na 404; zapis w demo nie trafia do bazy.
 */
function demoPublishedJob(jobId: string): JobDraftLoad {
  const job = DEMO_JOBS.find((j) => j.id === jobId);
  if (!job) return { status: 'not-found' };
  return {
    status: 'ok',
    jobId: job.id,
    jobStatus: 'active',
    slug: job.slug,
    updatedAt: job.createdAt ?? '',
    contentLocale: 'pl',
    values: {
      title: job.title,
      category: 'warehouse',
      occupation: job.title,
      contractType: 'permanent',
      workingHours: '38 h / tydzień',
      shifts: '',
      startImmediately: true,
      startDate: '',
      city: job.city,
      region: 'Flandria',
      address: '',
      remote: false,
      salaryMin: '16',
      salaryMax: '18',
      currency: 'EUR',
      salaryPeriod: 'hour',
      description: 'Praca w stałym zespole, szkolenie na start i jasny grafik zmian.',
      responsibilities: ['Obsługa stanowiska zgodnie z instrukcją'],
      requirementsMandatory: ['Dyspozycyjność'],
      mandatorySkills: [],
      minExperienceYears: '',
      requirementsOptional: [],
      skills: [],
      languages: [],
      requiredCertificates: [],
      requiresDrivingLicense: false,
      noLanguageRequired: true,
      conditions: [],
      benefits: [],
      accommodation: false,
      transport: false,
      companyDescription: 'Firma demonstracyjna z branży logistycznej.',
      contactEmail: '',
      screeningQuestions: [],
    },
  };
}

/**
 * Wczytuje ofertę firmy (szkic albo opublikowaną — aktywną/wstrzymaną, #325) do kształtu pól
 * kreatora (P1-04: koniec osieroconych draftów —
 * „Zapisz i wyjdź" nie gubi już pracy). Czyta POD SESJĄ (RLS: tylko oferty własnej firmy), więc
 * członek innej firmy dostanie `not-found`. Relacje (wymagania/umiejętności/języki/certyfikaty)
 * są wczytywane, bo kreator zapisuje je przez replace-all — bez nich „Dalej" by je wyczyścił
 * (ta sama pułapka co P1-07/P1-08). Błąd odczytu → 'error' (UI pokazuje retry, nie pusty kreator).
 */
export async function getJobDraft(jobId: string): Promise<JobDraftLoad> {
  if (!isPortalDataConfigured()) return demoPublishedJob(jobId);
  if (!UUID_RE.test(jobId)) return { status: 'not-found' };
  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'not-found' };
    const { me, companyId } = ctx;

    // Jedna transakcja: błąd dowolnej relacji przerywa odczyt → 'error'. Kreator startujący
    // z pustych relacji SKASOWAŁBY je przy zapisie (replace-all).
    const loaded = await withPortalTransaction(me, async (tx) => {
      const job = await queryOne(tx, 'employer.job-draft',
        `SELECT id, company_id, status, title, category, occupation, contract_type, working_hours,
                shifts, start_immediately, start_date, city, region, address, remote, salary_min,
                salary_max, currency, salary_period, min_experience_years, requires_driving_license,
                no_language_required, accommodation, transport, contact_email, default_locale, slug,
                expires_at, updated_at
           FROM public.jobs
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`, [jobId, companyId]);
      if (!job) return null;
      // #72: aktywna po terminie jest wygasła — najpierw ponowne otwarcie, jak dla `expired`.
      const jobStatus = effectiveJobStatus(asString(job['status']), asString(job['expires_at']) || null);
      if (!isEditableJobStatus(jobStatus)) return { job, jobStatus, relations: null };

      const locale = asString(job['default_locale'], 'pl');
      const relations = {
        translation: await queryOne(tx, 'employer.job-draft-translation',
          `SELECT description, responsibilities, conditions, benefits, company_description
             FROM public.job_translations WHERE job_id = $1 AND locale = $2`, [jobId, locale]),
        requirements: await queryRows(tx, 'employer.job-draft-requirements',
          'SELECT kind, content, position FROM public.job_requirements WHERE job_id = $1', [jobId]),
        skills: await queryRows(tx, 'employer.job-draft-skills',
          'SELECT skill_label, is_mandatory FROM public.job_skills WHERE job_id = $1', [jobId]),
        languages: await queryRows(tx, 'employer.job-draft-languages',
          'SELECT language_label, level FROM public.job_languages WHERE job_id = $1', [jobId]),
        certificates: await queryRows(tx, 'employer.job-draft-certificates',
          'SELECT certificate_label FROM public.job_certificates WHERE job_id = $1', [jobId]),
        // job_screening_questions_select (0093): członek firmy oferty.
        screening: await queryRows(tx, 'employer.job-draft-screening',
          `SELECT id, position, type, required, prompt, options
             FROM public.job_screening_questions WHERE job_id = $1 ORDER BY position`, [jobId]),
      };
      return { job, jobStatus, relations };
    });
    if (!loaded) return { status: 'not-found' };
    const { job, jobStatus, relations } = loaded;
    if (!isEditableJobStatus(jobStatus) || !relations) return { status: 'not-editable', jobStatus };
    const locale = asString(job['default_locale'], 'pl');
    const { translation, requirements, skills, languages, certificates, screening } = relations;

    const tr = asRecord(translation);
    const reqRows = requirements;
    const byKind = (kind: string): string[] =>
      reqRows
        .map((r) => asRecord(r))
        .filter((r) => asString(r['kind']) === kind)
        .sort((a, b) => asNumber(a['position']) - asNumber(b['position']))
        .map((r) => asString(r['content']))
        .filter(Boolean);
    const skillRows = skills.map((r) => asRecord(r));

    return {
      status: 'ok',
      jobId,
      jobStatus,
      slug: asString(job['slug']),
      updatedAt: asString(job['updated_at']),
      contentLocale: locale,
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
        languages: languages
          .map((r) => asRecord(r))
          .map((r) => ({
            language: asString(r['language_label']),
            level: asString(r['level'], 'basic'),
          }))
          .filter((l) => l.language !== ''),
        requiredCertificates: certificates
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
        screeningQuestions: parseScreeningQuestions(screening).map((q) => ({
          type: q.type,
          required: q.required,
          prompt: q.prompt,
          options: q.options.map((o) => ({ label: o.label })),
        })),
      },
    };
  } catch (error) {
    captureError(error, { area: 'employer.getJobDraft' });
    return { status: 'error' };
  }
}

/** Jawny stan odczytu dla ekranu ofert — błąd bazy nie może udawać pustej listy. */
export type CompanyJobsLoad =
  | { status: 'ok'; jobs: EmployerJob[]; prevCursor: string | null; nextCursor: string | null }
  | { status: 'error' };

export const EMPLOYER_JOBS_PAGE_SIZE = 12;

const FIRST_PAGE: ListPageRequest<never> = { cursor: null, direction: 'next' };

/**
 * Lista ofert firmy z liczbą nowych aplikacji i dopasowań na ofertę. Stronicowanie kursorem
 * (created_at, id) w obu kierunkach (P1-05) — bez OFFSET, więc oferta dodana między stronami
 * nie dubluje ani nie ukrywa rekordu na granicy.
 */
export async function getCompanyJobsLoad(
  request: ListPageRequest<TimeCursor> = FIRST_PAGE,
): Promise<CompanyJobsLoad> {
  if (!isPortalDataConfigured()) {
    // Izolowany serwer dev testów E2E (błąd odczytu, #185). Ta gałąź nie działa w buildzie produkcyjnym.
    if (process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'error') {
      return { status: 'error' };
    }
    // DEMO: jedna strona (identyfikatory demo nie są UUID, więc nie budujemy kursorów).
    return {
      status: 'ok',
      jobs: request.cursor ? [] : DEMO_JOBS.slice(0, EMPLOYER_JOBS_PAGE_SIZE),
      prevCursor: null,
      nextCursor: null,
    };
  }

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', jobs: [], prevCursor: null, nextCursor: null };
    const { me, companyId } = ctx;
    const prev = request.direction === 'prev';
    // Liczniki zgłoszeń i dopasowań czyta tylko recruiter+ (RLS 0039); zwykły `member` dostałby
    // z bazy 0 udające brak zainteresowania — pokazujemy „brak danych” (`null`).
    const recruiter = canRecruit(ctx.role);

    // Strona + znacznik kolejnej w kierunku odczytu. Liczniki liczone w bazie (count pod RLS) —
    // bez przesyłania wierszy aplikacji/dopasowań; błąd licznika = błąd całej listy.
    const rows = await withPortalTransaction(me, (tx) =>
      queryRows(tx, prev ? 'employer.jobs-page-prev' : 'employer.jobs-page',
        `SELECT j.id, j.title, j.city, j.status, j.slug, j.expires_at, j.created_at,
                (SELECT count(*) FROM public.applications a
                  WHERE a.company_id = $1 AND a.job_id = j.id
                    AND a.status = 'submitted' AND a.deleted_at IS NULL)::integer AS new_applications,
                (SELECT count(*) FROM public.matches m WHERE m.job_id = j.id)::integer AS matched
           FROM public.jobs j
          WHERE j.company_id = $1 AND j.deleted_at IS NULL
            AND ($2::timestamptz IS NULL OR (j.created_at, j.id) ${prev ? '>' : '<'} ($2::timestamptz, $3::uuid))
          ORDER BY ${prev ? 'j.created_at ASC, j.id ASC' : 'j.created_at DESC, j.id DESC'}
          LIMIT $4`,
        [companyId, request.cursor?.ts ?? null, request.cursor?.id ?? null, EMPLOYER_JOBS_PAGE_SIZE + 1]));

    const now = new Date();
    const page = toListPage(
      rows,
      request,
      EMPLOYER_JOBS_PAGE_SIZE,
      (r) => encodeTimeCursor({ ts: asString(r['created_at']), id: asString(r['id']) }),
      (r): EmployerJob => {
        const expiresAt = asString(r['expires_at']) || null;
        return {
          id: asString(r['id']),
          title: asString(r['title']),
          city: asString(r['city']),
          status: effectiveJobStatus(asString(r['status'], 'draft'), expiresAt, now),
          pastExpiry: isPastExpiry(expiresAt, now),
          slug: asString(r['slug']),
          newApplications: recruiter ? asNumber(r['new_applications']) : null,
          matched: recruiter ? asNumber(r['matched']) : null,
          createdAt: asString(r['created_at']) || null,
        };
      },
    );
    return { status: 'ok', jobs: page.items, prevCursor: page.prevCursor, nextCursor: page.nextCursor };
  } catch (error) {
    captureError(error, { area: 'employer.getCompanyJobs' });
    return { status: 'error' };
  }
}

/** Najnowsze aplikacje na oferty firmy (do wiersza akcji zmiany statusu). */
export type RecentApplicationsLoad =
  | { status: 'ok'; applications: EmployerApplication[] }
  | { status: 'error' };

export async function getRecentApplications(): Promise<RecentApplicationsLoad> {
  if (!isPortalDataConfigured()) return { status: 'ok', applications: DEMO_APPLICATIONS };

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', applications: [] };
    const { me, companyId } = ctx;

    // Kandydat, który aplikował, jest widoczny dla firmy (company_can_view_candidate) — RLS
    // przepuszcza odczyt profiles(imię/nazwisko) oraz jobs(tytuł) powiązanych z aplikacją.
    const data = await withPortalTransaction(me, (tx) =>
      queryRows(tx, 'employer.recent-applications',
        `SELECT ${APPLICATION_LIST_COLUMNS}
           FROM public.applications a
          WHERE a.company_id = $1 AND a.deleted_at IS NULL
          ORDER BY a.submitted_at DESC
          LIMIT 6`, [companyId]));

    const applications = asRows(data).map((r) => {
      const job = asEmbeddedRecord(r['jobs']);
      return {
        id: asString(r['id']),
        ...applicationCandidate(r),
        jobTitle: asString(job['title']),
        status: asString(r['status'], 'submitted'),
      };
    });
    return { status: 'ok', applications };
  } catch (error) {
    captureError(error, { area: 'employer.getRecentApplications' });
    return { status: 'error' };
  }
}

/** Pełna lista aplikacji w małych stronach; osobny wynik błędu chroni przed fałszywym pustym stanem. */
export type EmployerApplicationsLoad =
  | {
      status: 'ok';
      applications: EmployerApplication[];
      prevCursor: string | null;
      nextCursor: string | null;
      isDemo: boolean;
      /** Filtr oferty (`?oferta=`) z tytułem — tylko oferta aktywnej firmy widoczna pod RLS. */
      job: { id: string; title: string } | null;
    }
  | { status: 'not_found' }
  | { status: 'error' };

export const EMPLOYER_APPLICATIONS_PAGE_SIZE = 12;

/**
 * Zgłoszenia aktywnej firmy stronicowane kursorem (submitted_at, id) w obu kierunkach (P1-05),
 * opcjonalnie tylko dla jednej oferty. Oferta spoza firmy (albo niewidoczna pod RLS) =
 * `not_found`, nie pusta lista.
 */
export async function getEmployerApplicationsPage(
  request: ListPageRequest<TimeCursor> = FIRST_PAGE,
  jobId: string | null = null,
): Promise<EmployerApplicationsLoad> {
  if (jobId !== null && !UUID_RE.test(jobId)) return { status: 'not_found' };

  if (!isPortalDataConfigured()) {
    if (jobId !== null) return { status: 'not_found' };
    return {
      status: 'ok',
      applications: request.cursor ? [] : DEMO_APPLICATIONS,
      prevCursor: null,
      nextCursor: null,
      isDemo: true,
      job: null,
    };
  }

  try {
    const ctx = await loadContext();
    if (!ctx) {
      return jobId === null
        ? { status: 'ok', applications: [], prevCursor: null, nextCursor: null, isDemo: false, job: null }
        : { status: 'not_found' };
    }
    const { me, companyId } = ctx;
    const prev = request.direction === 'prev';

    const loaded = await withPortalTransaction(me, async (tx) => {
      const job = jobId === null
        ? null
        : await queryOne(tx, 'employer.applications-job',
            `SELECT id, title FROM public.jobs
              WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`, [jobId, companyId]);
      if (jobId !== null && !job) return null;
      // Strona + jeden wiersz znacznika kolejnej strony w kierunku odczytu.
      const rows = await queryRows(tx, prev ? 'employer.applications-page-prev' : 'employer.applications-page',
        `SELECT ${APPLICATION_LIST_COLUMNS}, a.submitted_at
           FROM public.applications a
          WHERE a.company_id = $1 AND a.deleted_at IS NULL
            AND ($2::uuid IS NULL OR a.job_id = $2::uuid)
            AND ($3::timestamptz IS NULL OR (a.submitted_at, a.id) ${prev ? '>' : '<'} ($3::timestamptz, $4::uuid))
          ORDER BY ${prev ? 'a.submitted_at ASC, a.id ASC' : 'a.submitted_at DESC, a.id DESC'}
          LIMIT $5`,
        [companyId, jobId, request.cursor?.ts ?? null, request.cursor?.id ?? null, EMPLOYER_APPLICATIONS_PAGE_SIZE + 1]);
      return { job, rows };
    });
    if (!loaded) return { status: 'not_found' };

    const page = toListPage(
      asRows(loaded.rows),
      request,
      EMPLOYER_APPLICATIONS_PAGE_SIZE,
      (row) => encodeTimeCursor({ ts: asString(row['submitted_at']), id: asString(row['id']) }),
      (row): EmployerApplication => {
        const job = asEmbeddedRecord(row['jobs']);
        return {
          id: asString(row['id']),
          ...applicationCandidate(row),
          jobTitle: asString(job['title']),
          status: asString(row['status'], 'submitted'),
        };
      },
    );
    return {
      status: 'ok',
      isDemo: false,
      applications: page.items,
      prevCursor: page.prevCursor,
      nextCursor: page.nextCursor,
      job: loaded.job ? { id: asString(loaded.job['id']), title: asString(loaded.job['title']) } : null,
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerApplicationsPage' });
    return { status: 'error' };
  }
}

interface MatchWinner {
  candidateId: string;
  jobId: string;
  score: number;
}

/** Zwycięzcy RPC dopasowań (jeden wiersz na kandydata, porządek z bazy) → typ domenowy. */
function matchWinners(rows: unknown): MatchWinner[] {
  const seen = new Set<string>();
  const winners: MatchWinner[] = [];
  for (const r of asRows(rows)) {
    const candidateId = asString(r['candidate_id']);
    if (!candidateId || seen.has(candidateId)) continue;
    seen.add(candidateId);
    winners.push({ candidateId, jobId: asString(r['job_id']), score: asNumber(r['score']) });
  }
  return winners;
}

/**
 * Dane kart kandydatów dla zwycięzców dopasowań — w tej samej transakcji pod sesją/RLS.
 * candidate_profiles: widoczność kandydata dla firmy; profiles (imię) tylko dla powiązanych
 * relacją (brak imienia → UI podstawia etykietę); jobs/offers: tytuł oferty docelowej i aktywna
 * propozycja (stan „wysłano” z DB, #327).
 */
async function matchedCandidateCards(tx: TransactionQuery, winners: MatchWinner[]): Promise<EmployerMatchedCandidate[]> {
  if (winners.length === 0) return [];
  const candidateIds = winners.map((w) => w.candidateId);
  const targetJobIds = [...new Set(winners.map((w) => w.jobId))].filter((id) => id.length > 0);

  const cpData = await queryRows(tx, 'employer.top-candidates-profiles',
    `SELECT profile_id, headline, city, occupations
       FROM public.candidate_profiles WHERE profile_id = ANY($1::uuid[])`, [candidateIds]);
  const profData = await queryRows(tx, 'employer.top-candidates-names',
    'SELECT id, first_name, last_name FROM public.profiles WHERE id = ANY($1::uuid[])', [candidateIds]);
  const jobData = await queryRows(tx, 'employer.top-candidates-jobs',
    'SELECT id, title, slug FROM public.jobs WHERE id = ANY($1::uuid[])', [targetJobIds]);
  const offerData = await queryRows(tx, 'employer.top-candidates-offers',
    `SELECT candidate_id, job_id, sent_at, created_at
       FROM public.offers
      WHERE candidate_id = ANY($1::uuid[]) AND job_id = ANY($2::uuid[])
        AND status IN ('sent', 'viewed') AND deleted_at IS NULL`, [candidateIds, targetJobIds]);

  const jobMap = new Map<string, { title: string; slug: string }>();
  for (const r of asRows(jobData)) {
    jobMap.set(asString(r['id']), { title: asString(r['title']), slug: asString(r['slug']) });
  }
  const offerMap = new Map<string, string>();
  for (const r of asRows(offerData)) {
    offerMap.set(
      `${asString(r['candidate_id'])}:${asString(r['job_id'])}`,
      asString(r['sent_at']) || asString(r['created_at']),
    );
  }
  const cpMap = new Map<string, Record<string, unknown>>();
  for (const r of asRows(cpData)) cpMap.set(asString(r['profile_id']), r);
  const nameMap = new Map<string, string>();
  for (const r of asRows(profData)) {
    nameMap.set(asString(r['id']), fullName(r['first_name'], r['last_name']));
  }

  return winners.map(({ candidateId, jobId, score }) => {
    const cp = cpMap.get(candidateId) ?? {};
    const occupations = Array.isArray(cp['occupations']) ? (cp['occupations'] as unknown[]) : [];
    const job = jobMap.get(jobId);
    return {
      candidateId,
      jobId,
      jobTitle: job?.title ?? '',
      jobSlug: job?.slug ?? '',
      offerSentAt: offerMap.get(`${candidateId}:${jobId}`) ?? null,
      name: nameMap.get(candidateId) ?? '',
      role: asString(cp['headline']) || asString(occupations[0]),
      city: asString(cp['city']),
      match: score,
    };
  });
}

/** Top dopasowani kandydaci (matches × candidate_profiles). Tylko dla firmy zweryfikowanej. */
export async function getTopMatchedCandidates(options?: { throwOnError?: boolean }): Promise<EmployerMatchedCandidate[]> {
  if (!isPortalDataConfigured()) return DEMO_CANDIDATES;

  try {
    const ctx = await loadContext();
    if (!ctx) return [];
    const { me, companyId, companyStatus } = ctx;

    // Dostęp do bazy dopasowanych kandydatów wymaga zweryfikowanej firmy.
    if (companyStatus !== 'verified') return [];

    return await withPortalTransaction(me, async (tx) => {
      // Najlepsze dopasowanie NA KANDYDATA liczone w bazie PRZED limitem (#141, 0079): kandydat
      // dopasowany do wielu ofert firmy nie wypiera innych. RPC działa pod RLS wywołującego
      // (recruiter+ firmy, widoczność kandydata) i zwraca już posortowanych zwycięzców.
      const matchData = await rpcRows(tx, 'get_company_top_matches', {
        p_company_id: companyId,
        p_limit: 5,
      });
      return matchedCandidateCards(tx, matchWinners(matchData).slice(0, 5));
    });
  } catch (error) {
    captureError(error, { area: 'employer.getTopMatchedCandidates' });
    if (options?.throwOnError) throw error;
    return [];
  }
}

export const EMPLOYER_CANDIDATES_PAGE_SIZE = 10;

export type MatchedCandidatesLoad =
  | ({ status: 'ok' } & ListPage<EmployerMatchedCandidate>)
  | { status: 'denied' }
  | { status: 'unverified' }
  | { status: 'error' };

/**
 * Wszyscy dopasowani kandydaci firmy (P1-05) — strony po {@link EMPLOYER_CANDIDATES_PAGE_SIZE}
 * kursorem (wynik, kandydat) w obu kierunkach (`get_company_matches_page`, 0192). Te same
 * reguły co top 5: jeden wiersz na kandydata, RLS wywołującego, tylko firma zweryfikowana
 * (`unverified`) i recruiter+ (`denied`).
 */
export async function getMatchedCandidatesPage(
  request: ListPageRequest<ScoreCursor> = FIRST_PAGE,
): Promise<MatchedCandidatesLoad> {
  const empty = { status: 'ok' as const, items: [], prevCursor: null, nextCursor: null };
  if (!isPortalDataConfigured()) {
    return request.cursor ? empty : { ...empty, items: DEMO_CANDIDATES };
  }

  try {
    const ctx = await loadContext();
    if (!ctx) return empty;
    const { me, companyId, companyStatus } = ctx;
    // Jak na pulpicie (P1-14): zwykły `member` i firma przed weryfikacją to jawne stany,
    // nie pusta lista udająca brak kandydatów.
    if (!canRecruit(ctx.role)) return { status: 'denied' };
    if (companyStatus !== 'verified') return { status: 'unverified' };

    return await withPortalTransaction(me, async (tx) => {
      const winners = matchWinners(await rpcRows(tx, 'get_company_matches_page', {
        p_company_id: companyId,
        p_limit: EMPLOYER_CANDIDATES_PAGE_SIZE + 1,
        p_cursor_score: request.cursor?.score ?? null,
        p_cursor_candidate: request.cursor?.id ?? null,
        p_direction: request.direction,
      }));
      // Znacznik kolejnej strony nie potrzebuje danych karty — wzbogacamy tylko widoczne wiersze.
      const page = toListPage(
        winners,
        request,
        EMPLOYER_CANDIDATES_PAGE_SIZE,
        (w) => encodeScoreCursor({ score: w.score, id: w.candidateId }),
        (w) => w,
      );
      return { status: 'ok' as const, ...page, items: await matchedCandidateCards(tx, page.items) };
    });
  } catch (error) {
    captureError(error, { area: 'employer.getMatchedCandidatesPage' });
    return { status: 'error' };
  }
}

/**
 * Jawny stan panelu „Top dopasowani” na pulpicie: błąd bazy, brak uprawnień rekrutera i firma
 * przed weryfikacją to trzy różne sytuacje — żadna nie może wyglądać jak pusta lista
 * („brak kandydatów”), bo pracodawca wyciągnąłby z niej zły wniosek.
 */
export type TopMatchedCandidatesLoad =
  | { status: 'ok'; candidates: EmployerMatchedCandidate[] }
  | { status: 'denied' }
  | { status: 'unverified' }
  | { status: 'error' };

export async function getTopMatchedCandidatesLoad(): Promise<TopMatchedCandidatesLoad> {
  if (!isPortalDataConfigured()) return { status: 'ok', candidates: DEMO_CANDIDATES };
  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', candidates: [] };
    if (!canRecruit(ctx.role)) return { status: 'denied' };
    if (ctx.companyStatus !== 'verified') return { status: 'unverified' };
    return { status: 'ok', candidates: await getTopMatchedCandidates({ throwOnError: true }) };
  } catch {
    // `getTopMatchedCandidates` zgłosił już błąd (captureError) przed ponownym rzuceniem.
    return { status: 'error' };
  }
}

/** Wiersz RPC `get_company_job_funnel` (0089). Liczniki bigint przychodzą jako number/string. */
interface JobFunnelRow {
  job_id: string;
  title: string | null;
  slug: string | null;
  status: string | null;
  search_appearances: number | string | null;
  detail_views: number | string | null;
  apply_started: number | string | null;
  applications_submitted: number | string | null;
}

function funnelCount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** Błąd uprawnień RPC (np. zwykły członek firmy bez roli rekrutera) — to nie awaria odczytu. */
function isPermissionDenied(error: unknown): boolean {
  return isDatabaseError(error) && error.code === '42501';
}

/**
 * Wiersze lejka ofert. RPC w sekcji `attempt`: odmowa uprawnień (42501) cofa tylko savepoint,
 * więc pozostałe liczniki tej samej transakcji zostają ważne.
 */
async function readJobFunnelRows(
  tx: TransactionQuery,
  companyId: string,
  range: FunnelDateRange,
): Promise<JobFunnelRow[] | 'denied'> {
  const result = await attempt(tx, () =>
    rpcRows<JobFunnelRow>(tx, 'get_company_job_funnel', {
      p_company_id: companyId,
      p_from: range.from,
      p_to: range.to,
    }));
  if (!result.ok) {
    if (isPermissionDenied(result.error)) return 'denied';
    throw result.error;
  }
  return result.value;
}

/**
 * Wyświetlenia szczegółów ofert z serwerowego lejka (#99) w oknie {@link FUNNEL_PERIOD_DAYS}
 * dni kalendarzowych (Europe/Brussels). `null` = brak uprawnień do lejka (nie zero).
 */
async function readFunnelViews(
  tx: TransactionQuery,
  companyId: string,
  now: Date,
): Promise<number | null> {
  const rows = await readJobFunnelRows(tx, companyId, funnelDateRange(FUNNEL_PERIOD_DAYS, now));
  if (rows === 'denied') return null;
  return rows.reduce((sum, row) => sum + funnelCount(row.detail_views), 0);
}

export interface JobFunnelMetrics {
  searchAppearances: number;
  detailViews: number;
  applyStarted: number;
  applicationsSubmitted: number;
}

export interface JobFunnelItem extends JobFunnelMetrics {
  jobId: string;
  title: string;
  slug: string;
  status: string;
}

/** Jawny stan odczytu lejka ofert (#99): brak uprawnień ≠ błąd ≠ zera. */
export type JobFunnelLoad =
  | { status: 'ok'; range: FunnelDateRange; totals: JobFunnelMetrics; jobs: JobFunnelItem[] }
  | { status: 'denied'; range: FunnelDateRange }
  | { status: 'error'; range: FunnelDateRange };

const DEMO_JOB_FUNNEL: JobFunnelItem[] = [
  { jobId: '12345', title: 'Operator wózka widłowego', slug: '', status: 'active', searchAppearances: 1840, detailViews: 412, applyStarted: 61, applicationsSubmitted: 38 },
  { jobId: '12344', title: 'Pracownik magazynu', slug: '', status: 'active', searchAppearances: 1322, detailViews: 305, applyStarted: 40, applicationsSubmitted: 26 },
  { jobId: '12343', title: 'Elektryk przemysłowy', slug: '', status: 'active', searchAppearances: 764, detailViews: 158, applyStarted: 19, applicationsSubmitted: 11 },
];

function sumFunnel(jobs: readonly JobFunnelMetrics[]): JobFunnelMetrics {
  return jobs.reduce<JobFunnelMetrics>(
    (acc, job) => ({
      searchAppearances: acc.searchAppearances + job.searchAppearances,
      detailViews: acc.detailViews + job.detailViews,
      applyStarted: acc.applyStarted + job.applyStarted,
      applicationsSubmitted: acc.applicationsSubmitted + job.applicationsSubmitted,
    }),
    { searchAppearances: 0, detailViews: 0, applyStarted: 0, applicationsSubmitted: 0 },
  );
}

/**
 * Lejek ofert aktywnej firmy (#99): pojawienia w wynikach → wyświetlenia → rozpoczęte
 * aplikowanie → wysłane aplikacje, per oferta, w zakresie dni Europe/Brussels. Odczyt przez
 * RPC `get_company_job_funnel` (recruiter+ aktywnej firmy, 0089). Bez env — dane DEMO.
 */
export async function getJobFunnel(
  days: FunnelRangeDays = DEFAULT_FUNNEL_RANGE,
  now: Date = new Date(),
): Promise<JobFunnelLoad> {
  const range = funnelDateRange(days, now);
  if (!isPortalDataConfigured()) {
    return { status: 'ok', range, totals: sumFunnel(DEMO_JOB_FUNNEL), jobs: DEMO_JOB_FUNNEL };
  }
  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'denied', range };
    const { companyId } = ctx;
    const rows = await withPortalTransaction(ctx.me, (tx) => readJobFunnelRows(tx, companyId, range));
    if (rows === 'denied') return { status: 'denied', range };
    const jobs: JobFunnelItem[] = rows.map((row) => ({
      jobId: row.job_id,
      title: row.title ?? '',
      slug: row.slug ?? '',
      status: row.status ?? '',
      searchAppearances: funnelCount(row.search_appearances),
      detailViews: funnelCount(row.detail_views),
      applyStarted: funnelCount(row.apply_started),
      applicationsSubmitted: funnelCount(row.applications_submitted),
    }));
    return { status: 'ok', range, totals: sumFunnel(jobs), jobs };
  } catch (error) {
    captureError(error, { area: 'employer.getJobFunnel' });
    return { status: 'error', range };
  }
}

/**
 * Lejek rekrutacyjny z ostatnich {@link FUNNEL_PERIOD_DAYS} dni (#302): kohorta aplikacji
 * złożonych w oknie (`submitted_at`), a w niej te, które KIEDYKOLWIEK osiągnęły etap rozmowy
 * / zatrudnienia (historia statusów — lejek monotoniczny, bez inwersji).
 *
 * Wszystkie trzy liczby to zapytania `count` liczone w bazie pod RLS (bez przesyłania wierszy
 * i list UUID). Etapy liczone jako aplikacje z `EXISTS` na historii → każda aplikacja liczona
 * raz (odpowiednik `count(distinct)`).
 * Wyświetlenia = suma `detail_views` z serwerowego lejka ofert (#99) w tym samym oknie dni;
 * `null`, gdy użytkownik nie ma uprawnień rekrutera (nie udajemy zera).
 */
export async function getFunnelStats(now: Date = new Date()): Promise<FunnelStatsLoad> {
  if (!isPortalDataConfigured()) return { status: 'ok', funnel: DEMO_FUNNEL };

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'ok', funnel: EMPTY_FUNNEL };
    const { me, companyId } = ctx;
    // Kohorta zgłoszeń pod RLS jest dla zwykłego `member` pusta (0039) — lejek z zerami
    // udawałby brak rekrutacji. Jawna odmowa, jak w lejku ofert (#99).
    if (!canRecruit(ctx.role)) return { status: 'denied' };
    const since = new Date(now.getTime() - FUNNEL_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const COHORT = `SELECT 1 FROM public.applications a
                     WHERE a.company_id = $1 AND a.deleted_at IS NULL AND a.submitted_at >= $2::timestamptz`;
    const REACHED = `AND EXISTS (SELECT 1 FROM public.application_status_history h
                                  WHERE h.application_id = a.id
                                    AND h.to_status = ANY($3::public.application_status[]))`;

    const { appCount, interviewCount, hiredCount, views } = await withPortalTransaction(me, async (tx) => ({
      appCount: await queryCount(tx, 'employer.funnel-applications', COHORT, [companyId, since]),
      interviewCount: await queryCount(tx, 'employer.funnel-interviews', `${COHORT} ${REACHED}`,
        [companyId, since, [...FUNNEL_INTERVIEW_STAGES]]),
      hiredCount: await queryCount(tx, 'employer.funnel-hired', `${COHORT} ${REACHED}`,
        [companyId, since, ['hired']]),
      views: await readFunnelViews(tx, companyId, now),
    }));

    return {
      status: 'ok',
      funnel: {
        views,
        applications: appCount,
        interviews: interviewCount,
        hired: hiredCount,
      },
    };
  } catch (error) {
    captureError(error, { area: 'employer.getFunnelStats' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Szczegół zgłoszenia (#300)
 * ------------------------------------------------------------------------- */

export interface EmployerApplicationDetail {
  id: string;
  status: string;
  candidateId: string;
  candidateName: string;
  jobId: string;
  jobTitle: string;
  /** Treść wpisana przez kandydata w formularzu aplikowania (pusta = brak). */
  message: string;
  phone: string;
  /** #98: aplikacja bez konta — kontakt e-mailowy ze snapshotu (pusty dla aplikacji z konta). */
  isGuest: boolean;
  guestEmail: string;
  /** Surowy `availability_status` (immediate/within_month/…); pusty = brak. */
  availability: string;
  submittedAt: string | null;
  /** Wynik dopasowania 0–100 (applications.match_score, inaczej matches.score); null = brak. */
  matchScore: number | null;
  /** Profil zawodowy — null, gdy kandydat nie ma profilu lub RLS go nie udostępnia. */
  profile: {
    headline: string;
    city: string;
    experienceYears: number | null;
    hasDrivingLicense: boolean;
    skills: string[];
    languages: { label: string; level: string }[];
    certificates: string[];
  } | null;
  /** Pierwsza strona (najstarsze najpierw) — #604, kolejne przez `getEmployerApplicationHistoryPage`. */
  history: ApplicationHistoryEntry[];
  /** Kursor kolejnej strony historii statusów (#604) — null = to wszystkie zmiany. */
  historyNextCursor: ApplicationHistoryCursor | null;
  /** #101: odpowiedzi na pytania oferty (snapshot z chwili aplikowania); pusta = brak pytań. */
  screeningAnswers: ScreeningAnswer[];
}

/**
 * Jawny stan odczytu szczegółu: `not_found` obejmuje zarówno brak rekordu, jak i brak dostępu
 * (RLS `applications_select` = recruiter+ firmy — 0039 — ukrywa cudze zgłoszenia jako brak
 * wiersza, więc nie rozróżniamy, by nie ujawniać istnienia cudzych danych).
 */
export type EmployerApplicationDetailLoad =
  | { status: 'ok'; application: EmployerApplicationDetail; isDemo: boolean }
  | { status: 'not_found' }
  | { status: 'error' };

/** Kursor historii statusów (`created_at` + `id`, stronicowanie rosnące — #604). */
export interface ApplicationHistoryCursor {
  createdAt: string;
  id: string;
}

export interface ApplicationHistoryEntry {
  id: string;
  toStatus: string;
  at: string;
}

export interface ApplicationHistoryPage {
  items: ApplicationHistoryEntry[];
  nextCursor: ApplicationHistoryCursor | null;
}

/** Rozmiar strony historii statusów aplikacji (#604) — dawny sztywny `LIMIT 50` bez paginacji. */
const APPLICATION_HISTORY_PAGE_SIZE = 50;

/**
 * Wiersze `id, to_status, created_at` (posortowane rosnąco, pobrane w liczbie
 * `APPLICATION_HISTORY_PAGE_SIZE + 1`) → strona + kursor kolejnej (#604).
 */
function pageHistoryRows(rows: unknown): ApplicationHistoryPage {
  const all = asRows(rows).map((r) => ({
    id: asString(r['id']),
    toStatus: asString(r['to_status']),
    at: asString(r['created_at']),
  }));
  const items = all.slice(0, APPLICATION_HISTORY_PAGE_SIZE);
  const last = items[items.length - 1];
  const nextCursor =
    all.length > APPLICATION_HISTORY_PAGE_SIZE && last ? { createdAt: last.at, id: last.id } : null;
  return { items, nextCursor };
}

const DEMO_APPLICATION_DETAILS: Record<string, Omit<EmployerApplicationDetail, 'id' | 'candidateName' | 'jobTitle' | 'status' | 'isGuest' | 'guestEmail' | 'screeningAnswers' | 'historyNextCursor'> & { screeningAnswers?: ScreeningAnswer[] }> = {
  'demo-app-1': {
    candidateId: 'demo-c-1', jobId: '12343', message: 'Mam 6 lat doświadczenia w utrzymaniu ruchu i uprawnienia SEP. Mogę zacząć od zaraz.',
    phone: '+32 470 12 34 56', availability: 'immediate', submittedAt: '2026-09-20T08:30:00Z', matchScore: 92,
    profile: { headline: 'Elektryk przemysłowy', city: 'Charleroi', experienceYears: 6, hasDrivingLicense: true, skills: ['Instalacje przemysłowe', 'Automatyka PLC'], languages: [{ label: 'Polski', level: 'native' }, { label: 'Francuski', level: 'intermediate' }], certificates: ['VCA Basis'] },
    history: [{ id: 'demo-h-1', toStatus: 'submitted', at: '2026-09-20T08:30:00Z' }],
    screeningAnswers: [
      { position: 0, type: 'yes_no', required: true, prompt: { pl: 'Czy masz uprawnienia SEP?', en: 'Do you hold an SEP certificate?' }, options: [], answerBoolean: true, answerDate: null, answerText: null },
      { position: 1, type: 'single_choice', required: true, prompt: { pl: 'Jak dojedziesz do pracy?', en: 'How will you get to work?' }, options: [{ id: 'o1', label: { pl: 'Własnym samochodem', en: 'Own car' } }, { id: 'o2', label: { pl: 'Komunikacją publiczną', en: 'Public transport' } }], answerBoolean: null, answerDate: null, answerText: 'o1' },
      { position: 2, type: 'date', required: false, prompt: { pl: 'Od kiedy możesz zacząć?', en: 'When can you start?' }, options: [], answerBoolean: null, answerDate: '2026-10-01', answerText: null },
      { position: 3, type: 'short_text', required: false, prompt: { pl: 'Doświadczenie z automatyką PLC', en: 'Experience with PLC automation' }, options: [], answerBoolean: null, answerDate: null, answerText: null },
    ],
  },
  'demo-app-2': {
    candidateId: 'demo-c-2', jobId: '12345', message: '',
    phone: '+32 471 98 76 54', availability: 'within_month', submittedAt: '2026-09-19T10:00:00Z', matchScore: 88,
    profile: { headline: 'Operator wózka widłowego', city: 'Liège', experienceYears: 4, hasDrivingLicense: true, skills: ['Wózek widłowy'], languages: [{ label: 'Polski', level: 'native' }], certificates: [] },
    history: [{ id: 'demo-h-2a', toStatus: 'submitted', at: '2026-09-19T10:00:00Z' }, { id: 'demo-h-2b', toStatus: 'viewed', at: '2026-09-19T14:00:00Z' }],
  },
  'demo-app-3': {
    candidateId: 'demo-c-3', jobId: '12344', message: 'Pracowałem 3 lata w magazynie w Antwerpii.',
    phone: '+32 472 11 22 33', availability: 'flexible', submittedAt: '2026-09-17T09:00:00Z', matchScore: 85,
    profile: null,
    history: [{ id: 'demo-h-3a', toStatus: 'submitted', at: '2026-09-17T09:00:00Z' }, { id: 'demo-h-3b', toStatus: 'viewed', at: '2026-09-17T12:00:00Z' }, { id: 'demo-h-3c', toStatus: 'shortlisted', at: '2026-09-18T09:00:00Z' }],
  },
  'demo-app-4': {
    candidateId: 'demo-c-4', jobId: '12341', message: '',
    phone: '', availability: '', submittedAt: '2026-09-15T09:00:00Z', matchScore: null,
    profile: null,
    history: [{ id: 'demo-h-4a', toStatus: 'submitted', at: '2026-09-15T09:00:00Z' }, { id: 'demo-h-4b', toStatus: 'interview', at: '2026-09-16T09:00:00Z' }],
  },
};

export async function getEmployerApplicationDetail(id: string): Promise<EmployerApplicationDetailLoad> {
  if (!isPortalDataConfigured()) {
    const base = DEMO_APPLICATIONS.find((application) => application.id === id);
    const extra = DEMO_APPLICATION_DETAILS[id];
    if (!base || !extra) return { status: 'not_found' };
    return {
      status: 'ok',
      isDemo: true,
      application: {
        ...base,
        ...extra,
        isGuest: false,
        guestEmail: '',
        historyNextCursor: null,
        screeningAnswers: extra.screeningAnswers ?? [],
      },
    };
  }

  if (!UUID_RE.test(id)) return { status: 'not_found' };

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'not_found' };
    const { me, companyId } = ctx;

    const loaded = await withPortalTransaction(me, async (tx) => {
      // RLS (0039): tylko kandydat lub recruiter+ oferty; dodatkowo zawężamy do AKTYWNEJ firmy.
      const row = await queryOne(tx, 'employer.application-detail',
        `SELECT a.id, a.status, a.candidate_id, a.guest_name, a.guest_email, a.job_id, a.message,
                a.phone, a.availability, a.submitted_at, a.match_score,
                (SELECT to_json(p) FROM (SELECT pr.first_name, pr.last_name FROM public.profiles pr
                                          WHERE pr.id = a.candidate_id) p) AS profiles,
                (SELECT to_json(j) FROM (SELECT jb.title FROM public.jobs jb
                                          WHERE jb.id = a.job_id) j) AS jobs
           FROM public.applications a
          WHERE a.id = $1 AND a.company_id = $2 AND a.deleted_at IS NULL`, [id, companyId]);
      if (!row) return null;

      const candidateId = asString(row['candidate_id']);
      const jobId = asString(row['job_id']);
      const candidate = applicationCandidate(row);
      // #98: aplikacja bez konta nie ma profilu ani dopasowania — nie pytamy o nie bazy.
      const withAccount = !candidate.isGuest && candidateId.length > 0;

      // #604: pobieramy jedną nadmiarową pozycję, aby wiedzieć, czy jest kolejna strona,
      // zamiast cicho obcinać historię do pierwszych 50 zmian bez sygnału i paginacji.
      const historyData = await queryRows(tx, 'employer.application-detail-history',
        `SELECT id, to_status, created_at FROM public.application_status_history
          WHERE application_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2`,
        [id, APPLICATION_HISTORY_PAGE_SIZE + 1]);
      // candidate_profiles_select_company (0009 + company_can_view_candidate recruiter+, 0033).
      const cpData = withAccount
        ? await queryOne(tx, 'employer.application-detail-profile',
            `SELECT id, headline, city, experience_years, has_driving_license
               FROM public.candidate_profiles WHERE profile_id = $1 AND deleted_at IS NULL`, [candidateId])
        : null;
      const matchData = withAccount
        ? await queryOne(tx, 'employer.application-detail-match',
            'SELECT score FROM public.matches WHERE candidate_id = $1 AND job_id = $2', [candidateId, jobId])
        : null;
      // application_screening_answers_select (0093): kandydat albo recruiter+ firmy oferty.
      const answerData = await queryRows(tx, 'employer.application-detail-answers',
        `SELECT position, type, required, prompt, options, answer_boolean, answer_date, answer_text
           FROM public.application_screening_answers WHERE application_id = $1 ORDER BY position`, [id]);

      let relations: { skills: Record<string, unknown>[]; languages: Record<string, unknown>[]; certificates: Record<string, unknown>[] } | null = null;
      if (cpData) {
        const cpId = asString(cpData['id']);
        relations = {
          skills: await queryRows(tx, 'employer.application-detail-skills',
            'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1 ORDER BY skill_label', [cpId]),
          languages: await queryRows(tx, 'employer.application-detail-languages',
            `SELECT language_label, level FROM public.candidate_languages
              WHERE candidate_profile_id = $1 ORDER BY language_label`, [cpId]),
          certificates: await queryRows(tx, 'employer.application-detail-certificates',
            `SELECT certificate_label FROM public.candidate_certificates
              WHERE candidate_profile_id = $1 ORDER BY certificate_label`, [cpId]),
        };
      }
      return { row, candidateId, jobId, candidate, historyData, cpData, matchData, answerData, relations };
    });
    if (!loaded) return { status: 'not_found' };
    const { row, candidateId, jobId, candidate, historyData, cpData, matchData, answerData, relations } = loaded;
    const job = asEmbeddedRecord(row['jobs']);
    const historyPage = pageHistoryRows(historyData);

    let profile: EmployerApplicationDetail['profile'] = null;
    if (cpData && relations) {
      const cp = asRecord(cpData);
      const years = cp['experience_years'];
      profile = {
        headline: asString(cp['headline']),
        city: asString(cp['city']),
        experienceYears: typeof years === 'number' ? years : null,
        hasDrivingLicense: cp['has_driving_license'] === true,
        skills: relations.skills.map((r) => asString(r['skill_label'])).filter(Boolean),
        languages: relations.languages
          .map((r) => ({ label: asString(r['language_label']), level: asString(r['level']) }))
          .filter((l) => l.label),
        certificates: relations.certificates.map((r) => asString(r['certificate_label'])).filter(Boolean),
      };
    }

    const appScore = row['match_score'];
    const matchScore =
      typeof appScore === 'number' ? appScore : matchData ? asNumber(asRecord(matchData)['score']) : null;

    return {
      status: 'ok',
      isDemo: false,
      application: {
        id: asString(row['id']),
        status: asString(row['status'], 'submitted'),
        candidateId,
        candidateName: candidate.candidateName,
        isGuest: candidate.isGuest === true,
        guestEmail: candidate.isGuest ? asString(row['guest_email']).trim() : '',
        jobId,
        jobTitle: asString(job['title']),
        message: asString(row['message']).trim(),
        phone: asString(row['phone']).trim(),
        availability: asString(row['availability']),
        submittedAt: asString(row['submitted_at']) || null,
        matchScore,
        profile,
        history: historyPage.items,
        historyNextCursor: historyPage.nextCursor,
        screeningAnswers: parseScreeningAnswers(answerData),
      },
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerApplicationDetail' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Szczegół kandydata (P1-06)
 * ------------------------------------------------------------------------- */

export interface EmployerCandidateDetail {
  candidateId: string;
  /** Imię i nazwisko tylko przy relacji z firmą (company_can_view_candidate); inaczej pusty. */
  name: string;
  profile: {
    headline: string;
    city: string;
    occupations: string[];
    experienceYears: number | null;
    availability: string;
    hasDrivingLicense: boolean;
    skills: string[];
    languages: { label: string; level: string }[];
    certificates: string[];
  } | null;
  /** Dopasowania do ofert AKTYWNEJ firmy, od najlepszego (najwyżej 10). */
  matches: {
    jobId: string;
    jobTitle: string;
    jobSlug: string;
    score: number;
    offerSentAt: string | null;
    /** Propozycję można wysłać tylko do aktywnej, niewygasłej oferty (`send_offer`). */
    canOffer: boolean;
  }[];
  /** Zgłoszenia kandydata do ofert aktywnej firmy, od najnowszego (najwyżej 20). */
  applications: { id: string; jobTitle: string; status: string; submittedAt: string | null }[];
}

export type EmployerCandidateDetailLoad =
  | { status: 'ok'; candidate: EmployerCandidateDetail; isDemo: boolean }
  | { status: 'not_found' }
  | { status: 'error' };

/**
 * Szczegół kandydata dla AKTYWNEJ firmy — pod sesją/RLS. Kandydat musi mieć z firmą relację
 * widoczną dla wywołującego: dopasowanie do jej oferty albo zgłoszenie. Brak relacji, brak
 * uprawnień (member, cudza firma) i nieistniejący kandydat dają ten sam `not_found` — bez
 * ujawniania istnienia cudzych danych. Profil zawodowy i imię czyta RLS (widoczność profilu,
 * `company_can_view_candidate`, blokady #97); CV i kontakt z konta nie są tu pokazywane.
 */
export async function getEmployerCandidateDetail(candidateId: string): Promise<EmployerCandidateDetailLoad> {
  if (!isPortalDataConfigured()) {
    const demo = DEMO_CANDIDATES.find((c) => c.candidateId === candidateId);
    if (!demo) return { status: 'not_found' };
    return {
      status: 'ok',
      isDemo: true,
      candidate: {
        candidateId: demo.candidateId,
        name: demo.name,
        profile: {
          headline: demo.role, city: demo.city, occupations: demo.role ? [demo.role] : [],
          experienceYears: null, availability: '', hasDrivingLicense: false, skills: [], languages: [], certificates: [],
        },
        matches: [{ jobId: demo.jobId, jobTitle: demo.jobTitle, jobSlug: demo.jobSlug, score: demo.match, offerSentAt: demo.offerSentAt, canOffer: true }],
        applications: [],
      },
    };
  }

  if (!UUID_RE.test(candidateId)) return { status: 'not_found' };

  try {
    const ctx = await loadContext();
    if (!ctx) return { status: 'not_found' };
    const { me, companyId } = ctx;

    const loaded = await withPortalTransaction(me, async (tx) => {
      // matches (recruiter+, widoczność kandydata) i applications (recruiter+) pod RLS, zawężone
      // do ofert aktywnej firmy.
      const matchRows = await queryRows(tx, 'employer.candidate-detail-matches',
        `SELECT m.job_id, m.score, j.title, j.slug,
                (j.status = 'active' AND (j.expires_at IS NULL OR j.expires_at > now())) AS can_offer
           FROM public.matches m
           JOIN public.jobs j ON j.id = m.job_id
          WHERE m.candidate_id = $1 AND j.company_id = $2 AND j.deleted_at IS NULL
          ORDER BY m.score DESC, m.job_id
          LIMIT 10`, [candidateId, companyId]);
      const applicationRows = await queryRows(tx, 'employer.candidate-detail-applications',
        `SELECT a.id, a.status, a.submitted_at,
                (SELECT to_json(j) FROM (SELECT jb.title FROM public.jobs jb WHERE jb.id = a.job_id) j) AS jobs
           FROM public.applications a
          WHERE a.candidate_id = $1 AND a.company_id = $2 AND a.deleted_at IS NULL
          ORDER BY a.submitted_at DESC, a.id DESC
          LIMIT 20`, [candidateId, companyId]);
      if (matchRows.length === 0 && applicationRows.length === 0) return null;

      const jobIds = matchRows.map((r) => asString(asRecord(r)['job_id'])).filter(Boolean);
      const offerRows = jobIds.length === 0 ? [] : await queryRows(tx, 'employer.candidate-detail-offers',
        `SELECT job_id, sent_at, created_at FROM public.offers
          WHERE candidate_id = $1 AND job_id = ANY($2::uuid[])
            AND status IN ('sent', 'viewed') AND deleted_at IS NULL`, [candidateId, jobIds]);
      const nameRow = await queryOne(tx, 'employer.candidate-detail-name',
        'SELECT first_name, last_name FROM public.profiles WHERE id = $1', [candidateId]);
      const cpRow = await queryOne(tx, 'employer.candidate-detail-profile',
        `SELECT id, headline, city, occupations, experience_years, availability, has_driving_license
           FROM public.candidate_profiles WHERE profile_id = $1 AND deleted_at IS NULL`, [candidateId]);
      let relations: { skills: Record<string, unknown>[]; languages: Record<string, unknown>[]; certificates: Record<string, unknown>[] } | null = null;
      if (cpRow) {
        const cpId = asString(cpRow['id']);
        relations = {
          skills: await queryRows(tx, 'employer.candidate-detail-skills',
            'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1 ORDER BY skill_label', [cpId]),
          languages: await queryRows(tx, 'employer.candidate-detail-languages',
            `SELECT language_label, level FROM public.candidate_languages
              WHERE candidate_profile_id = $1 ORDER BY language_label`, [cpId]),
          certificates: await queryRows(tx, 'employer.candidate-detail-certificates',
            `SELECT certificate_label FROM public.candidate_certificates
              WHERE candidate_profile_id = $1 ORDER BY certificate_label`, [cpId]),
        };
      }
      return { matchRows, applicationRows, offerRows, nameRow, cpRow, relations };
    });
    if (!loaded) return { status: 'not_found' };

    const offerMap = new Map<string, string>();
    for (const r of asRows(loaded.offerRows)) {
      offerMap.set(asString(r['job_id']), asString(r['sent_at']) || asString(r['created_at']));
    }
    let profile: EmployerCandidateDetail['profile'] = null;
    if (loaded.cpRow && loaded.relations) {
      const cp = asRecord(loaded.cpRow);
      const years = cp['experience_years'];
      profile = {
        headline: asString(cp['headline']),
        city: asString(cp['city']),
        occupations: Array.isArray(cp['occupations']) ? cp['occupations'].map((o) => asString(o)).filter(Boolean) : [],
        experienceYears: typeof years === 'number' ? years : null,
        availability: asString(cp['availability']),
        hasDrivingLicense: cp['has_driving_license'] === true,
        skills: loaded.relations.skills.map((r) => asString(r['skill_label'])).filter(Boolean),
        languages: loaded.relations.languages
          .map((r) => ({ label: asString(r['language_label']), level: asString(r['level']) }))
          .filter((l) => l.label),
        certificates: loaded.relations.certificates.map((r) => asString(r['certificate_label'])).filter(Boolean),
      };
    }

    return {
      status: 'ok',
      isDemo: false,
      candidate: {
        candidateId,
        name: loaded.nameRow ? fullName(loaded.nameRow['first_name'], loaded.nameRow['last_name']) : '',
        profile,
        matches: asRows(loaded.matchRows).map((r) => ({
          jobId: asString(r['job_id']),
          jobTitle: asString(r['title']),
          jobSlug: asString(r['slug']),
          score: asNumber(r['score']),
          offerSentAt: offerMap.get(asString(r['job_id'])) ?? null,
          canOffer: r['can_offer'] === true,
        })),
        applications: asRows(loaded.applicationRows).map((r) => ({
          id: asString(r['id']),
          jobTitle: asString(asEmbeddedRecord(r['jobs'])['title']),
          status: asString(r['status'], 'submitted'),
          submittedAt: asString(r['submitted_at']) || null,
        })),
      },
    };
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerCandidateDetail' });
    return { status: 'error' };
  }
}

/**
 * Kolejna strona historii statusów zgłoszenia (#604, „Pokaż więcej") — odczyt pod sesją i RLS,
 * ponownie zawężony do AKTYWNEJ firmy (nie ufamy samemu `applicationId` z klienta, jak w
 * `getEmployerApplicationDetail`). Obca/usunięta aplikacja → pusta strona bez ujawniania istnienia.
 */
export async function getEmployerApplicationHistoryPage(
  applicationId: string,
  cursor: ApplicationHistoryCursor | null = null,
): Promise<ApplicationHistoryPage> {
  const empty: ApplicationHistoryPage = { items: [], nextCursor: null };
  if (!UUID_RE.test(applicationId)) return empty;
  if (!isPortalDataConfigured()) return empty;

  try {
    const ctx = await loadContext();
    if (!ctx) return empty;
    const { me, companyId } = ctx;

    return await withPortalTransaction(me, async (tx) => {
      const owner = await queryOne(tx, 'employer.application-history-owner',
        `SELECT 1 FROM public.applications WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [applicationId, companyId]);
      if (!owner) return empty;

      const rows = await queryRows(tx, 'employer.application-history-page',
        `SELECT id, to_status, created_at FROM public.application_status_history
          WHERE application_id = $1
            AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
          ORDER BY created_at ASC, id ASC
          LIMIT $4`,
        [applicationId, cursor?.createdAt ?? null, cursor?.id ?? null, APPLICATION_HISTORY_PAGE_SIZE + 1]);
      return pageHistoryRows(rows);
    });
  } catch (error) {
    captureError(error, { area: 'employer.getEmployerApplicationHistoryPage' });
    return empty;
  }
}
