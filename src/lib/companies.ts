/**
 * Warstwa dostępu do publicznego profilu firmy (#591, migracja 0140).
 *
 * Stabilny, publiczny adres `/pracodawcy/<slug>` — tylko zweryfikowana, nieusunięta firma.
 * Bez konfiguracji DB (demo/build) profil zawsze „nie znaleziono": zestaw demonstracyjny
 * (`src/lib/data/demo.ts`) nie ma prawdziwych firm z osobnym adresem, więc nie udajemy, że ma
 * (Invariant #12) — CTA na szczególe oferty demo jest z tego samego powodu ukryte.
 */

import { isDatabaseConfigured, isProductionMode } from '@/lib/env';
import { isBuildPhase } from '@/lib/static-rendering';
import { AppError } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { routing, type Locale } from '@/i18n/routing';
import {
  getJobs,
  isRealJobsFixture,
  rowToJobListItem,
  withAgencyFlags,
  withListContentLocales,
  withListMachineTranslations,
  type JobListItem,
} from '@/lib/jobs';
import { fixtureCompanyBySlug } from '@/lib/company-fixture';

/** Zawęża dowolny string do obsługiwanego locale (fallback: język domyślny). Jak w `@/lib/jobs`. */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale) ? (locale as Locale) : routing.defaultLocale;
}

export interface CompanyProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
  city?: string;
  region?: string;
  industry?: string;
  logoUrl?: string;
  website?: string;
  activeJobsCount: number;
}

export interface CompanyProfileResult {
  company: CompanyProfile;
  /** Oferty bieżącej strony (najnowsze pierwsze, remis rozstrzyga id — migracja 0181). */
  jobs: JobListItem[];
  /** Bieżąca strona (1-indeksowana) i ostatnia osiągalna strona ofert profilu (#638). */
  page: number;
  lastPage: number;
  pageSize: number;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowToCompanyProfile(row: Record<string, unknown>): CompanyProfile {
  return {
    id: asString(row['id']),
    slug: asString(row['slug']),
    name: asString(row['name']),
    description: asString(row['description']),
    ...(asOptString(row['city']) ? { city: asOptString(row['city']) } : {}),
    ...(asOptString(row['region']) ? { region: asOptString(row['region']) } : {}),
    ...(asOptString(row['industry']) ? { industry: asOptString(row['industry']) } : {}),
    ...(asOptString(row['logo_url']) ? { logoUrl: asOptString(row['logo_url']) } : {}),
    ...(asOptString(row['website']) ? { website: asOptString(row['website']) } : {}),
    activeJobsCount: asNumber(row['active_jobs_count']),
  };
}

/**
 * Stronicowanie ofert profilu (#638). Dawniej profil pokazywał tylko pierwsze 50 ofert bez
 * informacji o obcięciu; teraz kolejne strony mają stabilne adresy
 * `/pracodawcy/<slug>/strona/<n>` (ISR — bez `searchParams`, więc cache stron publicznych
 * #298 zostaje). RPC przycina limit do 100 i offset do 10 000 (0140), więc ostatnia
 * osiągalna strona jest ograniczona — nigdy nie oferujemy strony, która zdublowałaby
 * przycięty wycinek (jak `jobListLastPage`, #593).
 */
export const COMPANY_JOBS_PAGE_SIZE = 50;
const COMPANY_JOBS_MAX_OFFSET = 10_000;
/** Serwer fixture E2E: mała strona, żeby zestaw fikcyjny (≤ 4 oferty na firmę) miał 2 strony. */
const FIXTURE_COMPANY_JOBS_PAGE_SIZE = 2;

/** Ostatnia osiągalna strona ofert profilu dla `count` aktywnych ofert (minimum 1). */
export function companyJobsLastPage(count: number, pageSize: number = COMPANY_JOBS_PAGE_SIZE): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, count) / pageSize));
  return Math.min(pages, Math.floor(COMPANY_JOBS_MAX_OFFSET / pageSize) + 1);
}

/**
 * Numer strony z segmentu `/strona/<n>`: tylko kanoniczny zapis dziesiętny ≥ 2 (strona 1 =
 * adres bazowy profilu, `01`/`1e1`/`2.0` = inny adres tej samej treści). Inne = `null` (404).
 */
export function parseCompanyJobsPageSegment(raw: string): number | null {
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 2 ? page : null;
}

/** Ścieżka strony ofert profilu (bez prefiksu języka); strona 1 = adres bazowy profilu. */
export function companyProfilePath(slug: string, page = 1): string {
  return page > 1 ? `/pracodawcy/${slug}/strona/${page}` : `/pracodawcy/${slug}`;
}

async function getCompanyProfileFromDb(
  slug: string,
  locale: string,
  page: number,
): Promise<CompanyProfileResult | null> {
  const [{ getDomainPool }, { getPublicCompany, getPublicCompanyJobs }] = await Promise.all([
    import('@/lib/db/runtime'),
    import('@/lib/db/public-companies'),
  ]);
  const pool = await getDomainPool();
  const companyRow = await getPublicCompany(pool, slug);
  if (!companyRow) return null;
  const company = rowToCompanyProfile(companyRow);
  const lastPage = companyJobsLastPage(company.activeJobsCount);
  // Strona za końcem = brak strony (404), nie pusta lista pod indeksowalnym adresem.
  if (page > lastPage) return null;
  const jobsResult = await getPublicCompanyJobs(
    pool,
    slug,
    locale,
    COMPANY_JOBS_PAGE_SIZE,
    (page - 1) * COMPANY_JOBS_PAGE_SIZE,
  );
  return {
    company,
    // Karty ofert profilu: przekład tytułu w języku strony (#33, 0160), jedno zapytanie.
    jobs: await withListMachineTranslations(
      pool,
      // 0167: etykieta „agencja” na kartach profilu firmy.
      // #1223: język treści kart (atrybut `lang`, gdy inny niż język strony).
      await withListContentLocales(pool, await withAgencyFlags(pool, jobsResult.rows.map(rowToJobListItem)), toLocale(locale)),
      toLocale(locale),
    ),
    page,
    lastPage,
    pageSize: COMPANY_JOBS_PAGE_SIZE,
  };
}

/**
 * Serwer fixture E2E (tryb `full`, nigdy build produkcyjny): profil zweryfikowanej firmy
 * fikcyjnej i jej oferty z tej samej listy fikcyjnej co `/oferty-pracy` (`companySlug`).
 */
async function getCompanyProfileFromFixture(
  slug: string,
  locale: Locale,
  page: number,
): Promise<CompanyProfileResult | null> {
  const company = fixtureCompanyBySlug(slug, locale);
  if (!company) return null;
  const { jobs } = await getJobs({ locale, page: 1, pageSize: 100 });
  // Jak `get_public_company_jobs`: oferty na profilu bez `company_slug` (bez linku do samego siebie).
  const companyJobs = jobs
    .filter((job) => job.companySlug === slug)
    .map(({ companySlug: _companySlug, ...job }) => job);
  const pageSize = FIXTURE_COMPANY_JOBS_PAGE_SIZE;
  const lastPage = companyJobsLastPage(companyJobs.length, pageSize);
  if (page > lastPage) return null;
  return {
    company: { ...company, activeJobsCount: companyJobs.length },
    jobs: companyJobs.slice((page - 1) * pageSize, page * pageSize),
    page,
    lastPage,
    pageSize,
  };
}

/**
 * Profil publiczny firmy po slugu i strona jego ofert (#638, domyślnie 1). `null` = firma nie
 * istnieje, nie jest zweryfikowana, jest usunięta albo strona wykracza poza ostatnią — strona
 * wywołująca renderuje 404 (nigdy technikaliów, Invariant #8).
 */
export async function getCompanyProfile(
  slug: string,
  locale: string,
  page = 1,
): Promise<CompanyProfileResult | null> {
  const resolvedLocale = toLocale(locale);
  if (!Number.isInteger(page) || page < 1) return null;

  if (isDatabaseConfigured()) {
    if (isBuildPhase()) return null;
    try {
      return await getCompanyProfileFromDb(slug, resolvedLocale, page);
    } catch (error) {
      captureError(error, { area: 'companies.getCompanyProfile', slug });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  if (isRealJobsFixture()) return getCompanyProfileFromFixture(slug, resolvedLocale, page);
  // Demo/dev bez bazy: brak prawdziwych firm z profilem — strona 404 zamiast fikcji (#297/#12).
  return null;
}
