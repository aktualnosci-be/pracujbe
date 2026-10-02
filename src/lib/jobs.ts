/**
 * Warstwa dostępu do danych ofert pracy — Pracuj.be.
 *
 * Publiczne RPC PostgreSQL działają pod ograniczoną rolą anon. Adapter importowany
 * jest leniwie. Demo działa wyłącznie poza APP_MODE=production i bez konfiguracji DB;
 * awaria skonfigurowanej bazy nigdy nie pokazuje fikcyjnych ofert.
 */

import { createHash } from 'node:crypto';

import { isDatabaseConfigured, isProductionMode } from '@/lib/env';
import { isBuildPhase } from '@/lib/static-rendering';
import { AppError } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { routing, type Locale } from '@/i18n/routing';
import { demoJobContentLocales, resolveDemoJobBySlug, resolveDemoJobs } from '@/lib/data/demo';
import { resolveJobContentLocales, resolveJobListContentLocale } from '@/lib/job-content-locale';
import {
  applyJobListMachineTranslation,
  applyJobMachineTranslation,
  type JobMachineTranslation,
} from '@/lib/job-machine-translation';
import { compareSalaryDesc, salaryInRange, type SalaryUnit } from '@/lib/salary-compare';
import type { TransactionPool } from '@/lib/db/transaction';
import { parseScreeningQuestions, type ScreeningQuestion } from '@/lib/screening/questions';
import { parseJobCostsRow, type JobCosts } from '@/lib/job-costs';
import { benefitsMatch, parseJobBenefitsRow, type JobBenefitCode, type JobBenefits } from '@/lib/job-benefits';
import { parseJobQualifications, type JobQualifications } from '@/lib/job-qualifications';
import {
  isApplyEmail,
  isApplyPhone,
  isApplyUrl,
  normalizeApplyPhone,
} from '@/lib/job-apply-channel';
import { fixtureScreeningQuestions } from '@/lib/screening/fixture';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { fixtureCompanySlug } from '@/lib/company-fixture';
import { searchFold } from '@/lib/search-fold';
import { isJobListPageBeyondLimit, jobListLastPage } from '@/lib/job-list-pagination';
import { createTtlSingleFlightCache } from '@/lib/cache/ttl-single-flight';
import type { JobFilterFacets } from '@/types/job-filter-facets';
import { resolveLanguageCode, type LanguageCode } from '@/lib/languages';
import { belgianCityCoordinates } from '@/lib/matching/belgian-cities';
import { isWorkMode, normalizeApplicantCountries } from '@/lib/job-work-mode';
import {
  isWorkTime,
  jobWithinRadius,
  workTimeMatches,
  type LanguageFilterLevel,
  type RadiusKm,
  type WorkTime,
  type WorkTimeFilter,
} from '@/lib/job-filter-options';
import {
  normalizeShiftPatterns,
  shiftPatternsMatch,
  type ShiftPattern,
} from '@/lib/job-shift-patterns';

export type ContractType =
  | 'permanent'
  | 'temporary'
  | 'interim'
  | 'freelance'
  | 'internship'
  | 'seasonal';

export type SalaryPeriod = 'hour' | 'month' | 'year';

export type CategoryKey =
  | 'construction'
  | 'transport'
  | 'warehouse'
  | 'production'
  | 'technical'
  | 'cleaning'
  | 'hospitality'
  | 'care'
  | 'logistics'
  | 'seasonal';

/** Miasta z danymi demonstracyjnymi i pierwszą listą landingów (#920: rdzeń katalogu). */
export type CoreLocationKey =
  | 'brussels'
  | 'antwerp'
  | 'ghent'
  | 'leuven'
  | 'mechelen'
  | 'hasselt'
  | 'liege'
  | 'charleroi'
  | 'bruges'
  | 'kortrijk';

/**
 * Klucz miasta z katalogu landingów `/praca/miasto/<klucz>` (#920) = klucz `locations.*`
 * w `src/messages`. Klucz = slug miejscowości w słowniku `locations` (0112). Katalog i reguła
 * kwalifikacji: `src/lib/locations/city-landings.ts`.
 */
export type LocationKey =
  | CoreLocationKey
  | 'namur'
  | 'mons'
  | 'aalst'
  | 'ostend'
  | 'genk'
  | 'sint-niklaas'
  | 'roeselare'
  | 'la-louviere'
  | 'tournai'
  | 'turnhout'
  | 'vilvoorde'
  | 'zaventem'
  | 'wavre';

export interface JobListItem {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  companyVerified: boolean;
  city: string;
  region: string;
  contractType: ContractType;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  salaryPeriod?: SalaryPeriod;
  publishedAt: string;
  isNew: boolean;
  highlights: string[];
  category: CategoryKey;
  accommodation: boolean;
  immediate: boolean;
  noLanguageRequired: boolean;
  /**
   * Oferta z zestawu demonstracyjnego (#297, Invariant #12) — fikcyjna firma i treść. UI
   * oznacza ją jako przykładową, nie pokazuje odznaki weryfikacji, nie emituje JobPosting
   * i nie pozwala aplikować. Oferty z bazy nigdy nie mają tej flagi.
   */
  isDemo?: true;
  /**
   * Stabilny slug profilu firmy (`/pracodawcy/<slug>`, tylko firma verified — 0140, #591).
   * Brak = brak publicznego profilu (bezpiecznik) — sitemap i CTA go wtedy pomijają.
   */
  companySlug?: string;
  /**
   * Treść przetłumaczona na język strony z kolejki tłumaczeń (#33): na szczególe całość
   * (0159), na karcie listy tytuł i wyróżniki (0160). Brak = treść własna oferty. Strona
   * oznacza przekład (szczegół: z linkiem do oryginału, karta: dyskretny znacznik).
   */
  machineTranslation?: JobMachineTranslation;
  /**
   * Język tytułu i wyróżników karty (#1223) — gdy różni się od języka strony, karta oznacza
   * je atrybutem `lang`. Brak = język nieznany albo niepoliczony (lista bez kart).
   * Przekład na język strony (`machineTranslation`) ustawia tu język strony.
   */
  contentLocale?: Locale;
  /**
   * 0167: oferta agencji pracy tymczasowej (deklaracja firmy; numer uznania sprawdza admin).
   * Karta i szczegół pokazują etykietę „agencja”; filtr „bezpośrednio od pracodawcy” je pomija.
   */
  isAgency?: true;
  /**
   * Praca zdalna (`jobs.remote`; od 0228 liczona z trybu pracy `work_mode = 'remote'`) — tylko zestaw demonstracyjny
   * niesie to pole na liście (lustro filtra promienia 0194: zdalna pasuje do każdego promienia).
   */
  remote?: boolean;
}

export interface JobApplyChannel {
  url?: string;
  email?: string;
  phone?: string;
}

/** Kanał z wiersza bazy — drugi raz te same reguły co CHECK (jak `publicHttpsUrl` w JSON-LD). */
export function parseJobApplyChannel(row: Record<string, unknown>): JobApplyChannel | undefined {
  const text = (key: string): string | undefined => {
    const v = row[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const url = text('apply_url');
  const email = text('apply_email');
  const phone = text('apply_phone');
  const channel: JobApplyChannel = {
    ...(url && isApplyUrl(url) ? { url } : {}),
    ...(email && isApplyEmail(email) ? { email } : {}),
    ...(phone && isApplyPhone(phone) ? { phone: normalizeApplyPhone(phone) } : {}),
  };
  return Object.keys(channel).length > 0 ? channel : undefined;
}

export interface JobDetail extends JobListItem {
  description: string;
  responsibilities: string[];
  requirementsMandatory: string[];
  requirementsOptional: string[];
  conditions: string[];
  workingHours: string;
  shifts?: string;
  languages: string[];
  transport: boolean;
  startDate?: string;
  companyDescription: string;
  /** Data wygaśnięcia oferty (ISO) — do JSON-LD validThrough (P1-12). */
  expiresAt?: string;
  /** Strona firmy (https, tylko firma verified — 0114) — JSON-LD `hiringOrganization.sameAs`. */
  companyWebsite?: string;
  /** Logo firmy (https, tylko firma verified — 0114) — JSON-LD `hiringOrganization.logo`. */
  companyLogoUrl?: string;
  /** Język treści (tytuł, opis, listy) — może różnić się od języka strony; brak = nieznany (#301). */
  contentLocale?: Locale;
  /** Języki z własnym tłumaczeniem treści; brak = nieznane, traktowane jak wszystkie (#301). */
  availableLocales?: Locale[];
  /** Pytania screeningowe do formularza aplikowania (#101); brak = oferta bez pytań. */
  screeningQuestions?: ScreeningQuestion[];
  /** „Koszty i dodatki” (0169); brak = odczyt nieudany albo oferta demo — strona pokazuje flagi. */
  costs?: JobCosts;
  /**
   * Świadczenia (#826, 0976 — `get_public_job_benefits`): kody efektywne z katalogu (z bonami
   * i zwrotem dojazdu z „Kosztów i dodatków”) + tekstowe „inne”. Brak = odczyt nieudany albo
   * nic nie podano — strona nie pokazuje sekcji.
   */
  benefits?: JobBenefits;
  /**
   * Umiejętności i certyfikaty oferty (#866, `job_skills`/`job_certificates` pod RLS anon);
   * brak = oferta bez kwalifikacji albo odczyt nieudany — strona pomija sekcję.
   */
  qualifications?: JobQualifications;
  /**
   * Kanał aplikowania u ogłoszeniodawcy (#1129, 0172 — `get_public_job`). Każde pole osobno
   * sprawdzone lustrem reguł bazy; brak pola = kanał niepodany, brak obiektu = żaden.
   */
  applyChannel?: JobApplyChannel;
  /**
   * Treść przetłumaczona na język strony z kolejki tłumaczeń (#33, 0159); brak = treść
   * własna oferty (w `contentLocale`). Strona oznacza przekład i linkuje do oryginału.
   */
  machineTranslation?: JobMachineTranslation;
  /**
   * #792: POTWIERDZONY tryb pracy. `remote` = 100% zdalnie (tylko wtedy JSON-LD może dostać
   * `jobLocationType: TELECOMMUTE`). Brak pola = tryb nieznany: dawny boolean `jobs.remote` NIE
   * gwarantuje pełnej zdalności i nie jest tu mapowany. Źródło (trójstanowy wybór w kreatorze +
   * odczyt w `get_public_job`): migracja 0228.
   */
  workMode?: 'onsite' | 'hybrid' | 'remote';
  /** #792: kody krajów (ISO 3166-1 alfa-2) dozwolone dla kandydata przy `workMode: 'remote'`. */
  remoteApplicantCountries?: string[];
  /**
   * #811 (0194): wymiar czasu pracy zadeklarowany przez pracodawcę (`jobs.work_time`); brak =
   * nie podano (nie zgadujemy z opisu godzin).
   */
  workTime?: WorkTime;
  /**
   * #858 (0227): typy grafiku pracy zadeklarowane przez pracodawcę (`jobs.shift_patterns`,
   * osobny odczyt `get_public_job_shift_patterns`); brak = nie podano albo odczyt nieudany.
   */
  shiftPatterns?: ShiftPattern[];
}

export interface GetJobsParams {
  locale: string;
  keyword?: string;
  city?: string;
  /** Pojedyncza kategoria (landing pages) — łączona z `categories` przy zapytaniu. */
  category?: CategoryKey;
  /** Pojedynczy typ umowy (landing pages) — łączony z `contractTypes`. */
  contractType?: ContractType;
  // --- Filtry zaawansowane sidebara (P1-12: liczone w SQL, nie w pamięci) ---
  categories?: CategoryKey[];
  locations?: string[];
  contractTypes?: ContractType[];
  salaryMin?: number;
  salaryMax?: number;
  /** Jednostka widełek i sortowania po wynagrodzeniu (#188, 0091); domyślnie 'month'. */
  salaryUnit?: SalaryUnit;
  /** true=tylko z zakwaterowaniem, false=tylko bez, undefined=bez filtra. */
  accommodation?: boolean;
  immediate?: boolean;
  noLanguageRequired?: boolean;
  /** 0167: tylko oferty spoza agencji pracy tymczasowej. */
  directOnly?: boolean;
  /** #786 (0194): wymagany język oferty (kod słownika). */
  language?: LanguageCode;
  /** #786: poziom kandydata — oferty wymagające języka najwyżej na tym poziomie (albo bez poziomu). */
  languageLevel?: LanguageFilterLevel;
  /** #811 (0194): wymiar pracy; oferta z oboma wariantami pasuje do obu. */
  workTime?: WorkTimeFilter;
  /** #858 (0227): typy grafiku — oferta z którymkolwiek z nich (bez deklaracji nie pasuje). */
  shiftPatterns?: ShiftPattern[];
  /** #824 (0194): miejscowość środka promienia (nazwa w dowolnym języku, słownik miejscowości). */
  near?: string;
  /** #824: promień w km (z `near`). */
  radiusKm?: RadiusKm;
  /** #826 (0976): świadczenia — oferta ma KAŻDE wybrane (kody katalogu). */
  benefits?: JobBenefitCode[];
  /** ISO timestamp — tylko oferty opublikowane >= tej daty (filtr „data"). */
  since?: string;
  /** Sortowanie wyników: 'newest' (domyślne) lub 'salary'. */
  sort?: 'newest' | 'salary';
  page?: number;
  pageSize?: number;
}

export interface GetJobsResult {
  jobs: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Ostatnia osiągalna strona (#593) — patrz `src/lib/job-list-pagination.ts`. */
  maxPage: number;
}

const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_LATEST_LIMIT = 6;
const NEW_DAYS = 10;

const CONTRACT_TYPES: readonly ContractType[] = [
  'permanent',
  'temporary',
  'interim',
  'freelance',
  'internship',
  'seasonal',
];
const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
];

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

/* ---------------------------------------------------------------------------
 * Ścieżka DEMO (fallback bez bazy)
 * ------------------------------------------------------------------------- */

/**
 * Serwer fixture E2E (`playwright.applications-fixture.config.ts`, tryb `full`): oferty
 * fikcyjne zastępują realny backend, więc nie są oznaczane jako demo — tam testujemy
 * formularz aplikowania i JobPosting. Nie działa w buildzie produkcyjnym.
 */
export function isRealJobsFixture(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full';
}

/**
 * Czy publiczne strony pokazują zestaw demonstracyjny (brak bazy poza APP_MODE=production).
 * Strony z ofertami pokazują wtedy baner „dane przykładowe” (#297).
 */
export function isShowingDemoJobs(): boolean {
  return !isDatabaseConfigured() && !isProductionMode() && !isRealJobsFixture();
}

function markDemo<T extends JobListItem>(job: T): T {
  if (!isRealJobsFixture()) return { ...job, isDemo: true };
  // Serwer fixture: slug profilu firmy jak `company_slug` z bazy (tylko firma zweryfikowana).
  const companySlug = fixtureCompanySlug(job.companyName, job.companyVerified);
  return companySlug ? { ...job, companySlug } : job;
}

function newestFirst(a: JobListItem, b: JobListItem): number {
  return b.publishedAt.localeCompare(a.publishedAt);
}

function getJobsFromDemo(
  locale: Locale,
  params: GetJobsParams,
  page: number,
  pageSize: number,
): GetJobsResult {
  let jobs: JobDetail[] = resolveDemoJobs(locale).map(markDemo);

  // Kategorie/typy umów: pojedyncze (landing) + tablice (sidebar) połączone (P1-12).
  const categories =
    params.categories ?? (params.category ? [params.category] : undefined);
  const contractTypes =
    params.contractTypes ??
    (params.contractType ? [params.contractType] : undefined);
  if (categories && categories.length > 0) {
    jobs = jobs.filter((job) => categories.includes(job.category));
  }
  if (contractTypes && contractTypes.length > 0) {
    jobs = jobs.filter((job) => contractTypes.includes(job.contractType));
  }
  if (params.locations && params.locations.length > 0) {
    const locs = params.locations;
    jobs = jobs.filter((job) => locs.includes(job.city));
  }
  if (params.city) {
    const q = searchFold(params.city.trim());
    if (q) {
      // Jak `search_city_candidates` (0153): tylko miasto oferty, bez sluga (#1119).
      jobs = jobs.filter((job) => searchFold(job.city).includes(q));
    }
  }
  if (params.keyword) {
    const q = searchFold(params.keyword.trim());
    if (q) {
      // Jak SQL (0110/0153, 0214): słowo kluczowe szuka w tytule oferty i w jej kwalifikacjach
      // (#866: wymagania w wyświetlanym języku; umiejętności i certyfikaty — demo ich nie ma),
      // nie w nazwie firmy, opisie ani wyróżnikach (#1119, lustro demo nie szuka szerzej niż baza).
      jobs = jobs.filter(
        (job) =>
          searchFold(job.title).includes(q) ||
          [...job.requirementsMandatory, ...job.requirementsOptional].some((line) =>
            searchFold(line).includes(q),
          ),
      );
    }
  }
  // Widełki w wybranej jednostce (#188, reguła jak w SQL 0080/0091): oferta bez
  // porównywalnej kwoty (brak wynagrodzenia albo inny okres stawki) NIE jest wykluczana.
  const salaryUnit = params.salaryUnit ?? 'month';
  if (params.salaryMin !== undefined || params.salaryMax !== undefined) {
    const lo = params.salaryMin ?? 0;
    const hi = params.salaryMax ?? Number.POSITIVE_INFINITY;
    jobs = jobs.filter((job) => salaryInRange(job, lo, hi, salaryUnit));
  }
  if (params.accommodation !== undefined) {
    jobs = jobs.filter((job) => job.accommodation === params.accommodation);
  }
  if (params.immediate) jobs = jobs.filter((job) => job.immediate);
  if (params.noLanguageRequired)
    jobs = jobs.filter((job) => job.noLanguageRequired);
  // 0194 — lustro warunków SQL dla danych demo: język (demo nie ma poziomów → każdy poziom
  // pasuje), wymiar pracy (`both` pasuje do obu, brak deklaracji — do żadnego), promień po
  // współrzędnych miast (nieznane miasto oferty albo środka = brak wyników); oferta zdalna
  // (`remote`) pasuje do każdego promienia (decyzja właściciela 29.09.2026, jak SQL 0194).
  if (params.language) {
    const code = params.language;
    jobs = jobs.filter((job) => job.languages.some((label) => resolveLanguageCode(label) === code));
  }
  if (params.workTime) {
    const wanted = params.workTime;
    jobs = jobs.filter((job) => workTimeMatches(job.workTime, wanted));
  }
  if (params.shiftPatterns?.length) {
    const wanted = params.shiftPatterns;
    jobs = jobs.filter((job) => shiftPatternsMatch(job.shiftPatterns, wanted));
  }
  if (params.benefits?.length) {
    const wanted = params.benefits;
    jobs = jobs.filter((job) => benefitsMatch(job.benefits?.codes ?? [], wanted));
  }
  if (params.near?.trim()) {
    const center = belgianCityCoordinates(params.near.trim());
    const radius = params.radiusKm ?? 25;
    jobs = jobs.filter((job) =>
      jobWithinRadius({ remote: job.remote, point: belgianCityCoordinates(job.city) }, center, radius),
    );
  }
  if (params.since) {
    const sinceTs = Date.parse(params.since);
    if (!Number.isNaN(sinceTs)) {
      jobs = jobs.filter((job) => {
        const ts = Date.parse(job.publishedAt);
        return !Number.isNaN(ts) && ts >= sinceTs;
      });
    }
  }

  const sorted = [...jobs].sort(
    params.sort === 'salary'
      ? (a, b) => compareSalaryDesc(a, b, salaryUnit) || newestFirst(a, b)
      : newestFirst,
  );
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const paged = isJobListPageBeyondLimit(page, pageSize)
    ? []
    : sorted.slice(start, start + pageSize);

  return { jobs: paged, total, page, pageSize, maxPage: jobListLastPage(total, pageSize) };
}

/* ---------------------------------------------------------------------------
 * Ścieżka PostgreSQL — błąd propagowany, bez fallbacku do fikcyjnych ofert
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumberOpt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asContractType(value: unknown): ContractType {
  const v = asString(value);
  return CONTRACT_TYPES.includes(v as ContractType)
    ? (v as ContractType)
    : 'permanent';
}

function asCategory(value: unknown): CategoryKey {
  const v = asString(value);
  return CATEGORY_KEYS.includes(v as CategoryKey)
    ? (v as CategoryKey)
    : 'logistics';
}

function asSalaryPeriod(value: unknown): SalaryPeriod | undefined {
  return value === 'hour' || value === 'month' || value === 'year'
    ? value
    : undefined;
}

function computeIsNew(publishedAt: string): boolean {
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

/** Wystawiona dla `@/lib/companies` (#591): profil firmy zwraca oferty w tym samym kształcie
 *  co `get_public_jobs`, więc mapowanie wiersza na `JobListItem` jest tylko jedno. */
export function rowToJobListItem(row: unknown): JobListItem {
  const r = asRecord(row);
  const publishedAt = asString(r['published_at'], new Date().toISOString());
  const salaryPeriod = asSalaryPeriod(r['salary_period']);
  return {
    id: asString(r['id']),
    slug: asString(r['slug']),
    title: asString(r['title']),
    companyName: asString(r['company_name']),
    companyVerified: asBool(r['company_verified']),
    city: asString(r['city']),
    region: asString(r['region']),
    contractType: asContractType(r['contract_type']),
    salaryMin: asNumberOpt(r['salary_min']),
    salaryMax: asNumberOpt(r['salary_max']),
    currency: asString(r['currency'], 'EUR'),
    ...(salaryPeriod ? { salaryPeriod } : {}),
    publishedAt,
    isNew: computeIsNew(publishedAt),
    highlights: asStringArray(r['highlights']),
    category: asCategory(r['category']),
    accommodation: asBool(r['accommodation']),
    immediate: asBool(r['immediate']),
    noLanguageRequired: asBool(r['no_language_required']),
    ...(asOptString(r['company_slug']) ? { companySlug: asOptString(r['company_slug']) } : {}),
  };
}

function rowToJobDetail(row: unknown): JobDetail {
  const r = asRecord(row);
  return {
    ...rowToJobListItem(row),
    description: asString(r['description']),
    responsibilities: asStringArray(r['responsibilities']),
    requirementsMandatory: asStringArray(r['requirements_mandatory']),
    requirementsOptional: asStringArray(r['requirements_optional']),
    conditions: asStringArray(r['conditions']),
    workingHours: asString(r['working_hours']),
    shifts: asOptString(r['shifts']),
    languages: asStringArray(r['languages']),
    transport: asBool(r['transport']),
    startDate: asOptString(r['start_date']),
    companyDescription: asString(r['company_description']),
    ...(asOptString(r['expires_at'])
      ? { expiresAt: asOptString(r['expires_at']) }
      : {}),
    ...(asOptString(r['company_website'])
      ? { companyWebsite: asOptString(r['company_website']) }
      : {}),
    ...(asOptString(r['company_logo_url'])
      ? { companyLogoUrl: asOptString(r['company_logo_url']) }
      : {}),
    // companySlug: już zmapowane przez rowToJobListItem (kolumna wspólna z get_public_jobs).
    ...(() => {
      const applyChannel = parseJobApplyChannel(r);
      return applyChannel ? { applyChannel } : {};
    })(),
    ...(isWorkTime(r['work_time']) ? { workTime: r['work_time'] } : {}),
    // #792 (0228): tryb pracy i kraje kandydata (null = tryb nieznany — JSON-LD bez TELECOMMUTE).
    ...(isWorkMode(r['work_mode']) ? { workMode: r['work_mode'] } : {}),
    ...(() => {
      const countries = normalizeApplicantCountries(asStringArray(r['remote_applicant_countries']));
      return countries.length > 0 ? { remoteApplicantCountries: countries } : {};
    })(),
  };
}

async function getJobsFromDb(
  params: GetJobsParams,
  page: number,
  pageSize: number,
  viewerId: string | null,
  translateCards: boolean,
  withTotal: boolean,
  withContentLocale: boolean,
): Promise<GetJobsResult | JobsPage> {
  const [{ getDomainPool }, { getPublicJobs, getPublicJobsPage }] = await Promise.all([
    import('@/lib/db/runtime'),
    import('@/lib/db/public-jobs'),
  ]);
  const pool = await getDomainPool();
  const query = { ...params, page, pageSize };
  const counted = withTotal ? await getPublicJobs(pool, query, viewerId) : null;
  const result = counted ?? (await getPublicJobsPage(pool, query, viewerId));
  const listed = await withAgencyFlags(pool, result.rows.map(rowToJobListItem));
  const jobs = translateCards
    ? await withListMachineTranslations(pool, await withListContentLocales(pool, listed, toLocale(params.locale)), toLocale(params.locale))
    : withContentLocale
      ? await withListContentLocales(pool, listed, toLocale(params.locale))
      : listed;
  if (!counted) return { jobs, page: result.page, pageSize: result.pageSize };
  return {
    jobs,
    total: counted.total,
    page: counted.page,
    pageSize: counted.pageSize,
    maxPage: counted.maxPage,
  };
}

async function getJobBySlugFromDb(
  slug: string,
  locale: string,
): Promise<JobDetail | null> {
  const [{ getDomainPool }, { getPublicJob }] = await Promise.all([
    import('@/lib/db/runtime'),
    import('@/lib/db/public-jobs'),
  ]);
  const pool = await getDomainPool();
  const first = await getPublicJob(pool, slug, locale);
  if (!first) return null;
  const [job] = await withAgencyFlags(pool, [rowToJobDetail(first)]);
  if (!job) return null;
  // #101: pytania są częścią formularza aplikowania — błąd odczytu przerywa jak błąd oferty
  // (formularz bez pytań i tak zostałby odrzucony przez bazę przy pytaniach wymaganych).
  const { getPublicJobScreeningQuestions, getPublicJobCosts } = await import('@/lib/db/public-jobs');
  // Decyzja produktowa: portal ogłoszeniowy — stare pytania ukryte, bez zapytania do bazy.
  const screeningQuestions = isRecruitmentEnabled('screening')
    ? parseScreeningQuestions(await getPublicJobScreeningQuestions(pool, job.id))
    : [];
  // 0169: koszty i dodatki — odczyt pomocniczy; awaria zostawia same flagi (bez szczegółów).
  let costs: JobCosts | undefined;
  try {
    costs = parseJobCostsRow(await getPublicJobCosts(pool, job.id));
  } catch (error) {
    captureError(error, { area: 'jobs.getJobCosts' });
  }
  // 0227 (#858): grafik pracy — odczyt pomocniczy; awaria = sam opis tekstowy godzin/zmian.
  let shiftPatterns: ShiftPattern[] = [];
  try {
    const { getPublicJobShiftPatterns } = await import('@/lib/db/public-jobs');
    const raw = await getPublicJobShiftPatterns(pool, job.id);
    shiftPatterns = normalizeShiftPatterns(Array.isArray(raw) ? raw : []);
  } catch (error) {
    captureError(error, { area: 'jobs.getJobShiftPatterns' });
  }
  // 0976 (#826): świadczenia — odczyt pomocniczy; awaria = brak sekcji (reszta strony zostaje).
  let benefits: JobBenefits | undefined;
  try {
    const { getPublicJobBenefits } = await import('@/lib/db/public-jobs');
    benefits = parseJobBenefitsRow(await getPublicJobBenefits(pool, job.id, locale));
  } catch (error) {
    captureError(error, { area: 'jobs.getJobBenefits' });
  }
  // #866: umiejętności i certyfikaty — odczyt pomocniczy; awaria = strona bez sekcji.
  let qualifications: JobQualifications | undefined;
  try {
    const { getPublicJobQualifications } = await import('@/lib/db/public-jobs');
    const rows = await getPublicJobQualifications(pool, job.id, locale);
    qualifications = parseJobQualifications(rows.skills, rows.certificates);
  } catch (error) {
    captureError(error, { area: 'jobs.getJobQualifications' });
  }
  const requested = toLocale(locale);
  const withLocales: JobDetail = {
    ...job,
    ...(costs ? { costs } : {}),
    ...(shiftPatterns.length > 0 ? { shiftPatterns } : {}),
    ...(benefits && (benefits.codes.length > 0 || benefits.other.length > 0) ? { benefits } : {}),
    ...(qualifications ? { qualifications } : {}),
    ...(await readContentLocales(pool, job, requested)),
    ...(screeningQuestions.length > 0 ? { screeningQuestions } : {}),
  };
  return readMachineTranslation(pool, withLocales, requested);
}

/**
 * Przekład na język strony (#33). Tylko za flagą `AI_TRANSLATION_ENABLED`, tylko gdy treść
 * oferty jest w innym (znanym) języku niż strona. Odczyt pomocniczy: jego awaria zostawia
 * oryginał i loguje sam kod obszaru (bez treści oferty).
 */
async function readMachineTranslation(
  pool: TransactionPool,
  job: JobDetail,
  locale: Locale,
): Promise<JobDetail> {
  if (!job.contentLocale || job.contentLocale === locale) return job;
  if (job.availableLocales?.includes(locale)) return job;
  try {
    const { isTranslationDisplayEnabled } = await import('@/lib/translation/config');
    if (!isTranslationDisplayEnabled()) return job;
    const { getPublicJobMachineTranslation } = await import('@/lib/db/public-jobs');
    const row = await getPublicJobMachineTranslation(pool, job.id, locale);
    return applyJobMachineTranslation(job, row, locale);
  } catch (error) {
    captureError(error, { area: 'jobs.readMachineTranslation', jobId: job.id });
    return job;
  }
}

/**
 * Przekład tytułu i wyróżników kart listy (#33, 0160) — JEDNO zapytanie na stronę (lista id),
 * nigdy zapytanie na kartę. Tylko za flagą `AI_TRANSLATION_ENABLED`, w tym samym renderze
 * serwera co lista (strony ISR dostają gotowy HTML). Odczyt pomocniczy: awaria = karty
 * w oryginale + kod obszaru w logu (bez treści ofert).
 */
export async function withListMachineTranslations<T extends JobListItem>(
  pool: TransactionPool,
  jobs: T[],
  locale: Locale,
): Promise<T[]> {
  if (jobs.length === 0) return jobs;
  try {
    const { isTranslationDisplayEnabled } = await import('@/lib/translation/config');
    if (!isTranslationDisplayEnabled()) return jobs;
    const { getPublicJobsMachineTitles } = await import('@/lib/db/public-jobs');
    const rows = await getPublicJobsMachineTitles(pool, jobs.map((job) => job.id), locale);
    if (rows.length === 0) return jobs;
    const byId = new Map(rows.map((row) => [row.job_id, row]));
    return jobs.map((job) => applyJobListMachineTranslation(job, byId.get(job.id) ?? null, locale));
  } catch (error) {
    captureError(error, { area: 'jobs.readListMachineTranslations' });
    return jobs;
  }
}

/**
 * Język tytułu i wyróżników kart (#1223) — JEDNO zapytanie o tłumaczenia ofert strony, bez zmiany
 * RPC listy (`resolveJobListContentLocale`). Odczyt pomocniczy: awaria = karty bez `lang`
 * + kod obszaru w logu.
 */
export async function withListContentLocales<T extends JobListItem>(
  pool: TransactionPool,
  jobs: T[],
  locale: Locale,
): Promise<T[]> {
  if (jobs.length === 0) return jobs;
  try {
    const { getPublicJobListTranslations } = await import('@/lib/db/public-jobs');
    const rows = await getPublicJobListTranslations(pool, jobs.map((job) => job.id));
    const byJob = new Map<string, typeof rows>();
    for (const row of rows) byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), row]);
    return jobs.map((job) => {
      const contentLocale = resolveJobListContentLocale(locale, job, byJob.get(job.id) ?? []);
      return contentLocale ? { ...job, contentLocale } : job;
    });
  } catch (error) {
    captureError(error, { area: 'jobs.readListContentLocales' });
    return jobs;
  }
}

/**
 * Etykieta „agencja” (0167) — JEDNO zapytanie na stronę listy (lista id). Odczyt pomocniczy:
 * awaria = karty bez etykiety + kod obszaru w logu (filtr listy i tak działa w SQL).
 */
export async function withAgencyFlags<T extends JobListItem>(
  pool: TransactionPool,
  jobs: T[],
): Promise<T[]> {
  if (jobs.length === 0) return jobs;
  try {
    const { getPublicJobsAgency } = await import('@/lib/db/public-jobs');
    const agency = await getPublicJobsAgency(pool, jobs.map((job) => job.id));
    if (agency.size === 0) return jobs;
    return jobs.map((job) => (agency.has(job.id) ? { ...job, isAgency: true as const } : job));
  } catch (error) {
    captureError(error, { area: 'jobs.withAgencyFlags' });
    return jobs;
  }
}

/**
 * Języki treści oferty (#301). Odczyt pomocniczy: jego awaria nie może zablokować strony oferty,
 * więc błąd jest logowany, a oferta zachowuje się jak dotąd (język nieznany).
 */
async function readContentLocales(
  pool: TransactionPool,
  job: JobDetail,
  locale: Locale,
): Promise<Pick<JobDetail, 'contentLocale' | 'availableLocales'>> {
  try {
    const { getPublicJobTranslations } = await import('@/lib/db/public-jobs');
    const rows = await getPublicJobTranslations(pool, [job.id]);
    const resolved = resolveJobContentLocales(locale, job, rows);
    if (resolved.availableLocales.length === 0) return {};
    return {
      availableLocales: resolved.availableLocales,
      ...(resolved.contentLocale ? { contentLocale: resolved.contentLocale } : {}),
    };
  } catch (error) {
    captureError(error, { area: 'jobs.readContentLocales', jobId: job.id });
    return {};
  }
}

/* ---------------------------------------------------------------------------
 * Publiczne API (kontrakt @/lib/jobs)
 * ------------------------------------------------------------------------- */

/**
 * Kontekst osoby przeglądającej listę. `candidateId` wyłącznie ze zweryfikowanej sesji
 * serwera (`readCandidateViewerId`); brak = gość, wynik wspólny (ISR/statyczne strony).
 */
export interface JobsViewer {
  candidateId: string | null;
}

/**
 * Opcje odczytu listy. `translateCards` — lista trafia na karty ofert (`JobCard`), więc
 * dostaje przekład tytułu w języku strony (#33). Sitemap, liczniki i facety go nie potrzebują.
 * `withTotal: false` (PERF-04, #1230) — bez `get_public_jobs_count`: dla sekcji, które nie
 * pokazują licznika ani paginacji (wynik bez `total`/`maxPage`, pilnuje tego typ).
 */
export interface GetJobsOptions {
  translateCards?: boolean;
  withTotal?: boolean;
  /**
   * #1223: język treści każdej oferty (`contentLocale`) bez przekładu kart — dla list, które
   * pokazują tytuły poza `JobCard` (pulpit kandydata). `translateCards` liczy go zawsze.
   */
  withContentLocale?: boolean;
}

/** Strona listy bez licznika (`getJobs(…, { withTotal: false })`). */
export type JobsPage = Omit<GetJobsResult, 'total' | 'maxPage'>;

export async function getJobs(
  params: GetJobsParams,
  viewer: JobsViewer | undefined,
  options: GetJobsOptions & { withTotal: false },
): Promise<JobsPage>;
export async function getJobs(
  params: GetJobsParams,
  viewer?: JobsViewer,
  options?: GetJobsOptions,
): Promise<GetJobsResult>;
export async function getJobs(
  params: GetJobsParams,
  viewer?: JobsViewer,
  options: GetJobsOptions = {},
): Promise<GetJobsResult | JobsPage> {
  const locale = toLocale(params.locale);
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE),
  );
  const withTotal = options.withTotal !== false;

  if (isDatabaseConfigured()) {
    if (isBuildPhase()) {
      return withTotal ? { jobs: [], total: 0, page, pageSize, maxPage: 1 } : { jobs: [], page, pageSize };
    }
    try {
      return await getJobsFromDb(
        params,
        page,
        pageSize,
        viewer?.candidateId ?? null,
        options.translateCards === true,
        withTotal,
        options.withContentLocale === true,
      );
    } catch (error) {
      // Skonfigurowana baza NIE może po cichu degradować do danych demonstracyjnych
      // (fikcyjne oferty indeksowane jako realne). Loguj i propaguj kontrolowany błąd.
      captureError(error, { area: 'jobs.getJobs' });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  const demo = getJobsFromDemo(locale, params, page, pageSize);
  if (withTotal) return demo;
  return { jobs: demo.jobs, page: demo.page, pageSize: demo.pageSize };
}

/**
 * PERF-04 (#1230): sam licznik publicznych ofert dla filtra (metadane landingów, liczba partii
 * sitemap) — bez odczytu wierszy listy. Widok gościa (bez blokad kandydata, #97), tak jak
 * wywołujący, którzy zastąpili nim `getJobs({ pageSize: 1 }).total`. Błąd = `AppError('INTERNAL')`.
 */
export async function getJobsCount(params: GetJobsParams): Promise<number> {
  if (isDatabaseConfigured()) {
    if (isBuildPhase()) return 0;
    try {
      const [{ getDomainPool }, { getPublicJobsCount }] = await Promise.all([
        import('@/lib/db/runtime'),
        import('@/lib/db/public-jobs'),
      ]);
      return await getPublicJobsCount(await getDomainPool(), params);
    } catch (error) {
      captureError(error, { area: 'jobs.getJobsCount' });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  return getJobsFromDemo(toLocale(params.locale), params, 1, 1).total;
}

export async function getJobBySlug(
  slug: string,
  locale: string,
): Promise<JobDetail | null> {
  const resolvedLocale = toLocale(locale);

  if (isDatabaseConfigured()) {
    if (isBuildPhase()) return null;
    try {
      return await getJobBySlugFromDb(slug, resolvedLocale);
    } catch (error) {
      captureError(error, { area: 'jobs.getJobBySlug', slug });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  const job = resolveDemoJobBySlug(slug, resolvedLocale);
  if (!job) return null;
  // Serwer fixture E2E: pytania screeningowe na wybranej ofercie fikcyjnej (#101).
  const screeningQuestions =
    isRealJobsFixture() && isRecruitmentEnabled('screening') ? fixtureScreeningQuestions(job.id) : [];
  return markDemo(screeningQuestions.length > 0 ? { ...job, screeningQuestions } : job);
}

/**
 * Jawny wynik odczytu podobnych ofert (#191). Sekcja pomocnicza: jej awaria nie może
 * przerwać renderowania szczegółu oferty ani aplikowania, a „brak podobnych” wolno pokazać
 * tylko po udanym odczycie.
 */
export type SimilarJobsLoad =
  | { status: 'ok'; jobs: JobListItem[] }
  | { status: 'error' };

/**
 * Wymusza błąd odczytu podobnych ofert na izolowanym serwerze dev testów E2E
 * (`playwright.applications-fixture.config.ts`). Nie działa w buildzie produkcyjnym.
 */
function isSimilarJobsErrorFixture(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'error';
}

/** Do `limit` aktywnych ofert z tej samej kategorii, bez oferty bieżącej. */
export async function getSimilarJobs(
  job: Pick<JobListItem, 'slug' | 'category'>,
  locale: string,
  limit: number,
): Promise<SimilarJobsLoad> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  try {
    if (isSimilarJobsErrorFixture()) throw new Error('Isolated similar jobs fixture failure');
    const result = await getJobs(
      { locale, category: job.category, page: 1, pageSize: safeLimit + 1 },
      undefined,
      { withTotal: false },
    );
    return {
      status: 'ok',
      jobs: result.jobs.filter((item) => item.slug !== job.slug).slice(0, safeLimit),
    };
  } catch (error) {
    captureError(error, { area: 'jobs.getSimilarJobs' });
    return { status: 'error' };
  }
}

export async function getLatestJobs(
  locale: string,
  limit: number = DEFAULT_LATEST_LIMIT,
): Promise<JobListItem[]> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const result = await getJobs(
    { locale, page: 1, pageSize: safeLimit },
    undefined,
    { translateCards: true, withTotal: false },
  );
  return result.jobs;
}

/**
 * #903: krótki cache + single-flight (jak `/api/job-filter-facets`, #595) na poziomie tej
 * współdzielonej funkcji — chroni też renderowanie SSR listy ofert (`oferty-pracy/page.tsx`),
 * które woła agregat facetów BEZPOŚREDNIO, z pominięciem cache endpointu AJAX. Klucz uwzględnia
 * `candidateId` widza (#97: wynik zależy od zablokowanych przez niego firm), więc wynik jednego
 * kandydata nigdy nie trafia do innego ani do gościa.
 */
const JOB_FILTER_FACETS_CACHE_TTL_MS = 15_000;
const JOB_FILTER_FACETS_CACHE_MAX_ENTRIES = 500;
const jobFilterFacetsCache = createTtlSingleFlightCache<JobFilterFacets>({
  ttlMs: JOB_FILTER_FACETS_CACHE_TTL_MS,
  maxEntries: JOB_FILTER_FACETS_CACHE_MAX_ENTRIES,
});

/** Stabilny klucz (kolejność kluczy obiektu i tablic filtrów nie wpływa na trafienie w cache). */
function jobFilterFacetsCacheKey(
  params: GetJobsParams,
  candidateId: string | null,
): string {
  const canonical = JSON.stringify(params, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : value,
  );
  return createHash('sha256')
    .update(`${candidateId ?? ''}|${canonical}`)
    .digest('hex');
}

export async function getJobFilterFacets(
  params: GetJobsParams,
  viewer?: JobsViewer,
): Promise<JobFilterFacets | null> {
  if (!isDatabaseConfigured() || isBuildPhase()) return null;
  const candidateId = viewer?.candidateId ?? null;
  return jobFilterFacetsCache.run(jobFilterFacetsCacheKey(params, candidateId), async () => {
    try {
      const [{ getDomainPool }, { getPublicJobFilterFacets }] = await Promise.all(
        [import('@/lib/db/runtime'), import('@/lib/db/public-jobs')],
      );
      return await getPublicJobFilterFacets(await getDomainPool(), params, candidateId);
    } catch (error) {
      captureError(error, { area: 'jobs.getJobFilterFacets' });
      throw new AppError('INTERNAL');
    }
  });
}

/**
 * Czy miejscowość promienia (#824) jest rozpoznana (słownik z współrzędnymi). Lista i tak jest
 * wtedy pusta (SQL nie zgaduje odległości) — strona mówi, dlaczego. Awaria odczytu = `true`
 * (bez fałszywego komunikatu; błąd w kanale).
 */
export async function isRadiusPlaceKnown(near: string): Promise<boolean> {
  const place = near.trim();
  if (!place) return true;
  if (!isDatabaseConfigured()) return belgianCityCoordinates(place) !== undefined;
  if (isBuildPhase()) return true;
  try {
    const [{ getDomainPool }, { isPublicRadiusPlaceKnown }] = await Promise.all([
      import('@/lib/db/runtime'),
      import('@/lib/db/public-jobs'),
    ]);
    return await isPublicRadiusPlaceKnown(await getDomainPool(), place);
  } catch (error) {
    captureError(error, { area: 'jobs.isRadiusPlaceKnown' });
    return true;
  }
}

/**
 * Języki z własnym tłumaczeniem dla listy ofert (sitemap, #301). `null` = nieznane (błąd odczytu);
 * oferta bez wpisu w wyniku nie ma żadnego tłumaczenia.
 */
export async function getJobsAvailableLocales(
  jobIds: readonly string[],
): Promise<Record<string, Locale[]> | null> {
  if (!isDatabaseConfigured()) {
    return Object.fromEntries(jobIds.map((id) => [id, demoJobContentLocales(id)]));
  }
  if (isBuildPhase()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobTranslations }] = await Promise.all([
      import('@/lib/db/runtime'),
      import('@/lib/db/public-jobs'),
    ]);
    const rows = await getPublicJobTranslations(await getDomainPool(), jobIds);
    const result: Record<string, Locale[]> = {};
    for (const row of rows) {
      const locale = toLocale(row.locale);
      const list = (result[row.job_id] ??= []);
      if (!list.includes(locale)) list.push(locale);
    }
    return result;
  } catch (error) {
    captureError(error, { area: 'jobs.getJobsAvailableLocales' });
    return null;
  }
}

/**
 * P1-09: REALNE liczniki ofert per kategoria (koniec zmyślonych liczb na stronie głównej).
 * Zwraca `null` w trybie demo (brak env) — komponent pomija wtedy badge zamiast pokazywać
 * konkretną, nieprawdziwą liczbę. Liczy dokładnie tym samym filtrem, którym link kieruje na
 * listę (`category=<key>`), więc licznik odpowiada temu, co użytkownik zobaczy po kliknięciu.
 */
export async function getCategoryCounts(
  _locale: string,
  keys: readonly string[],
): Promise<Record<string, number> | null> {
  if (!isDatabaseConfigured() || isBuildPhase()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobCategoryCounts }] =
      await Promise.all([
        import('@/lib/db/runtime'),
        import('@/lib/db/public-jobs'),
    ]);
    const pool = await getDomainPool();
    const validKeys = keys.filter((key) =>
      CATEGORY_KEYS.includes(key as CategoryKey),
    );
    const counts = await getPublicJobCategoryCounts(pool, validKeys);
    return Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]));
  } catch (error) {
    captureError(error, { area: 'jobs.getCategoryCounts' });
    return null;
  }
}

/**
 * P1-09 / #189: REALNE liczniki ofert per KLUCZ miasta (nie per przetłumaczona nazwa). Liczy z
 * facetu lokalizacji i sumuje dokładne aliasy klucza (Bruksela/Brussel/Bruxelles/Brussels) —
 * tą samą regułą, którą landing i lista filtrują oferty, więc licznik nie zależy od języka
 * strony ani języka, w którym wpisano miasto oferty. `null` w trybie demo.
 */
export async function getCityCounts(
  locale: string,
  keys: readonly LocationKey[],
): Promise<Record<LocationKey, number> | null> {
  if (!isDatabaseConfigured() || isBuildPhase()) return null;
  try {
    const [{ getDomainPool }, { getPublicJobFilterFacets }, { countByLocationKey }] =
      await Promise.all([
        import('@/lib/db/runtime'),
        import('@/lib/db/public-jobs'),
        import('@/lib/locations/city-aliases'),
      ]);
    const facets = await getPublicJobFilterFacets(await getDomainPool(), { locale });
    return countByLocationKey(facets.locations, keys);
  } catch (error) {
    captureError(error, { area: 'jobs.getCityCounts' });
    return null;
  }
}
