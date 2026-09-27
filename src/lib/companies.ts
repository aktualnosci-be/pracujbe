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
import { getJobs, isRealJobsFixture, rowToJobListItem, type JobListItem } from '@/lib/jobs';
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
  jobs: JobListItem[];
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

const COMPANY_JOBS_LIMIT = 50;

async function getCompanyProfileFromDb(
  slug: string,
  locale: string,
): Promise<CompanyProfileResult | null> {
  const [{ getDomainPool }, { getPublicCompany, getPublicCompanyJobs }] = await Promise.all([
    import('@/lib/db/runtime'),
    import('@/lib/db/public-companies'),
  ]);
  const pool = await getDomainPool();
  const companyRow = await getPublicCompany(pool, slug);
  if (!companyRow) return null;
  const jobsResult = await getPublicCompanyJobs(pool, slug, locale, COMPANY_JOBS_LIMIT, 0);
  return {
    company: rowToCompanyProfile(companyRow),
    jobs: jobsResult.rows.map(rowToJobListItem),
  };
}

/**
 * Serwer fixture E2E (tryb `full`, nigdy build produkcyjny): profil zweryfikowanej firmy
 * fikcyjnej i jej oferty z tej samej listy fikcyjnej co `/oferty-pracy` (`companySlug`).
 */
async function getCompanyProfileFromFixture(slug: string, locale: Locale): Promise<CompanyProfileResult | null> {
  const company = fixtureCompanyBySlug(slug, locale);
  if (!company) return null;
  const { jobs } = await getJobs({ locale, page: 1, pageSize: COMPANY_JOBS_LIMIT });
  // Jak `get_public_company_jobs`: oferty na profilu bez `company_slug` (bez linku do samego siebie).
  const companyJobs = jobs
    .filter((job) => job.companySlug === slug)
    .map(({ companySlug: _companySlug, ...job }) => job);
  return {
    company: { ...company, activeJobsCount: companyJobs.length },
    jobs: companyJobs,
  };
}

/**
 * Profil publiczny firmy po slugu. `null` = firma nie istnieje, nie jest zweryfikowana albo
 * jest usunięta — strona wywołująca renderuje 404 (nigdy technikaliów, Invariant #8).
 */
export async function getCompanyProfile(
  slug: string,
  locale: string,
): Promise<CompanyProfileResult | null> {
  const resolvedLocale = toLocale(locale);

  if (isDatabaseConfigured()) {
    if (isBuildPhase()) return null;
    try {
      return await getCompanyProfileFromDb(slug, resolvedLocale);
    } catch (error) {
      captureError(error, { area: 'companies.getCompanyProfile', slug });
      throw new AppError('INTERNAL');
    }
  }

  if (isProductionMode()) throw new AppError('INTERNAL');
  if (isRealJobsFixture()) return getCompanyProfileFromFixture(slug, resolvedLocale);
  // Demo/dev bez bazy: brak prawdziwych firm z profilem — strona 404 zamiast fikcji (#297/#12).
  return null;
}
