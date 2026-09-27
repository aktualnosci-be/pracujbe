import type { Locale } from '@/i18n/routing';
import { demoCompanies, demoCompanyLocation } from '@/lib/data/demo';

/**
 * Profile firm na serwerze fixture E2E (`playwright.applications-fixture.config.ts`, tryb
 * `full`). Wołane wyłącznie z gałęzi fixture w `@/lib/jobs` i `@/lib/companies` — w buildzie
 * produkcyjnym profil i slug firmy pochodzą z bazy (`get_public_company`, migracja 0140).
 *
 * Jak w bazie: profil i slug ma tylko firma zweryfikowana (fikcyjne firmy niezweryfikowane nie
 * dostają linku i zwracają 404), a jedna fikcyjna firma bez aktywnych ofert pozwala sprawdzić
 * `noindex` strony profilu bez ofert.
 */

/** Zweryfikowana firma fikcyjna bez aktywnych ofert (profil istnieje, `noindex`). */
export const FIXTURE_COMPANY_WITHOUT_JOBS_SLUG = 'fikcyjna-firma-bez-ofert';

const WITHOUT_JOBS_NAME = 'Fikcyjna Firma Bez Ofert BV';

/** Slug z nazwy — jak `companySlug` w `src/lib/actions/company.ts` (bez sufiksu unikalności). */
function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Slug profilu dla oferty fikcyjnej — tylko firma zweryfikowana (jak `company_slug` w bazie). */
export function fixtureCompanySlug(companyName: string, companyVerified: boolean): string | undefined {
  return companyVerified ? slugFromName(companyName) : undefined;
}

export interface FixtureCompany {
  id: string;
  slug: string;
  name: string;
  description: string;
  city: string;
  region: string;
}

/** Profil zweryfikowanej firmy fikcyjnej po slugu; firma niezweryfikowana albo zły slug = `null`. */
export function fixtureCompanyBySlug(slug: string, locale: Locale): FixtureCompany | null {
  if (slug === FIXTURE_COMPANY_WITHOUT_JOBS_SLUG) {
    return {
      id: 'fixture-company-without-jobs',
      slug,
      name: WITHOUT_JOBS_NAME,
      description: '',
      city: 'Gent',
      region: 'Oost-Vlaanderen',
    };
  }
  const company = demoCompanies.find((item) => item.verified && slugFromName(item.name) === slug);
  if (!company) return null;
  return {
    id: company.id,
    slug,
    name: company.name,
    description: company.description[locale],
    ...demoCompanyLocation(company, locale),
  };
}
