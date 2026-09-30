/**
 * Dane strukturalne (schema.org JSON-LD) i wspólny obraz marki do metadanych publicznych stron.
 *
 * Czyste funkcje bez i18n i bez env: nagłówki sekcji opisu oferty oraz bazowy URL przychodzą
 * z wywołującego (strona serwerowa), dzięki czemu reguły (#313) są testowane jednostkowo.
 */

import type { ContractType, JobDetail } from '@/lib/jobs';
import { normalizeSalary } from '@/lib/salary';

/** Ścieżka obrazu udostępniania marki (1200×630, `public/og.png`). */
export const SHARE_IMAGE_PATH = '/og.png';
/** Znak marki (kwadrat 512×512) — logo wydawcy w danych strukturalnych. */
export const BRAND_LOGO_PATH = '/icon-512.png';
export const BRAND_NAME = 'Pracuj.be';

/** Bezwzględny adres obrazu marki dla og:image / twitter:image / Article.image. */
export function brandShareImageUrl(base: string): string {
  return new URL(SHARE_IMAGE_PATH, base).href;
}

/** Serializacja JSON-LD do `<script>`: „<” escapowane, aby dane z bazy nie zamknęły tagu. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Adres do publikacji w danych strukturalnych: bezwzględny https z nazwą hosta (co najmniej
 * jedna kropka), bez danych logowania, najwyżej 2048 znaków; inaczej `undefined`. Druga
 * warstwa po `public_https_url` w bazie (0114) — dane mogą też przyjść z innego źródła.
 */
export function publicHttpsUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || raw.length > 2048 || !raw.startsWith('https://') || /[\s"<>\\`]/.test(raw)) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined;
  const labels = parsed.hostname.split('.');
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return undefined;
  return parsed.href;
}

/**
 * Mapowanie rodzaju umowy na schema.org `employmentType` (#842).
 *
 * Rodzaj umowy i wymiar czasu pracy (pełny/część etatu) to dwie NIEZALEŻNE cechy oferty —
 * `permanent` („Umowa na stałe”) nie mówi nic o wymiarze; godziny są osobnym wolnym tekstem
 * (`job.workingHours`, `src/lib/validation/job.ts`), którego celowo NIE zgadujemy (oferta na
 * część etatu z umową na stałe istnieje naprawdę). Dlatego `permanent` jest tu pominięty —
 * `buildJobPostingJsonLd` w ogóle nie emituje `employmentType` dla niepotwierdzonego wymiaru,
 * zamiast fałszywie deklarować `FULL_TIME`. Pozostałe rodzaje (`temporary`/`interim`/
 * `freelance`/`internship`/`seasonal`) same w sobie są kategorią zatrudnienia niezależną od
 * wymiaru, więc zostają. Jawny wymiar etatu (#811, 0194: `jobs.work_time`) dokłada
 * `FULL_TIME`/`PART_TIME` tylko wtedy, gdy pracodawca go zadeklarował (`WORK_TIME_EMPLOYMENT`).
 */
const EMPLOYMENT_TYPE: Partial<Record<ContractType, string>> = {
  temporary: 'TEMPORARY',
  interim: 'TEMPORARY',
  freelance: 'CONTRACTOR',
  internship: 'INTERN',
  seasonal: 'TEMPORARY',
};

/** #811 (0194): zadeklarowany wymiar pracy → `employmentType` (oba warianty = obie wartości). */
const WORK_TIME_EMPLOYMENT: Record<NonNullable<JobDetail['workTime']>, readonly string[]> = {
  full_time: ['FULL_TIME'],
  part_time: ['PART_TIME'],
  both: ['FULL_TIME', 'PART_TIME'],
};

function employmentTypes(job: JobDetail): string[] {
  const types = [...(job.workTime ? WORK_TIME_EMPLOYMENT[job.workTime] : [])];
  const contract = EMPLOYMENT_TYPE[job.contractType];
  if (contract && !types.includes(contract)) types.push(contract);
  return types;
}

const SALARY_UNIT: Record<NonNullable<JobDetail['salaryPeriod']>, string> = {
  hour: 'HOUR',
  month: 'MONTH',
  year: 'YEAR',
};

/** Nagłówki sekcji opisu w języku strony (z `src/messages`, namespace `job`). */
export interface JobPostingLabels {
  responsibilities: string;
  requirementsMandatory: string;
  requirementsOptional: string;
  conditions: string;
  workingHours: string;
  shifts: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function listSection(heading: string, items: readonly string[]): string {
  const values = clean(items);
  if (values.length === 0) return '';
  return `<h3>${escapeHtml(heading)}</h3><ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function textSection(heading: string, value: string | undefined): string {
  const text = value?.trim();
  if (!text) return '';
  return `<h3>${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p>`;
}

/**
 * Pełny opis oferty w HTML (wytyczne Google for Jobs): opis, obowiązki, wymagania obowiązkowe
 * i mile widziane, warunki, godziny pracy i zmiany. Treść z bazy jest escapowana.
 */
export function buildJobPostingDescription(job: JobDetail, labels: JobPostingLabels): string {
  return [
    paragraphs(job.description),
    listSection(labels.responsibilities, job.responsibilities),
    listSection(labels.requirementsMandatory, job.requirementsMandatory),
    listSection(labels.requirementsOptional, job.requirementsOptional),
    listSection(labels.conditions, job.conditions),
    textSection(labels.workingHours, job.workingHours),
    textSection(labels.shifts, job.shifts),
  ].join('');
}

/**
 * JobPosting dla detalu oferty. `validThrough` wyłącznie z realnego `expiresAt` — bez daty
 * wygaśnięcia pole jest pomijane (wymyślona data zdejmowała aktywne oferty z Google, #313).
 *
 * `directApply` (#840): portal nie ma pola z zewnętrznym adresem ATS — każda realna, kanoniczna
 * oferta (wywołujący pomija demo i wersje bez tłumaczenia treści, #297/#301) ma pełny formularz
 * aplikowania na tej samej stronie (zalogowany kandydat albo gość bez konta), więc `true`. Gdy
 * w przyszłości pojawi się oferta bez tego przepływu (np. link zewnętrzny), tę wartość trzeba
 * wyliczać z danych oferty zamiast stałej.
 *
 * #1130 (decyzja produktowa: portal ogłoszeniowy): w trybie ogłoszeniowym kandydat aplikuje
 * u ogłoszeniodawcy (strona/e-mail/telefon), nie na tej stronie — wywołujący podaje
 * `directApply: false`.
 */
/**
 * #792 (Google: „work from home jobs”): `jobLocationType: TELECOMMUTE` tylko dla POTWIERDZONEJ pracy
 * w 100% zdalnej (`workMode === 'remote'`) i z co najmniej jednym poprawnym krajem kandydata
 * (`applicantLocationRequirements` jest wtedy wymagane — bez niego oznaczenie byłoby błędnym
 * markupem). Praca stacjonarna, hybrydowa, okazjonalnie zdalna albo tryb nieznany (dawny boolean
 * `remote`) zostaje zwykłym `jobLocation`. Zwraca `undefined`, gdy warunki nie są spełnione.
 */
function telecommuteFields(job: JobDetail): Record<string, unknown> | undefined {
  if (job.workMode !== 'remote') return undefined;
  const countries = [
    ...new Set(
      (job.remoteApplicantCountries ?? [])
        .map((code) => code.trim().toUpperCase())
        .filter((code) => /^[A-Z]{2}$/.test(code)),
    ),
  ];
  if (countries.length === 0) return undefined;
  const requirements = countries.map((name) => ({ '@type': 'Country', name }));
  return {
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: requirements.length === 1 ? requirements[0] : requirements,
  };
}

export function buildJobPostingJsonLd(
  job: JobDetail,
  url: string,
  labels: JobPostingLabels,
  /**
   * 0169: `jobBenefits` (tekst schema.org) — świadczenia z „Kosztów i dodatków” w języku strony
   * (`buildJobBenefitsText`). Brak = pole pominięte.
   */
  options: { jobBenefits?: string; directApply?: boolean } = {},
): Record<string, unknown> {
  const expiresTs = job.expiresAt ? Date.parse(job.expiresAt) : Number.NaN;
  const validThrough = Number.isNaN(expiresTs) ? undefined : new Date(expiresTs).toISOString();

  // Te same widełki co w paszporcie oferty (#22): jedna granica → minValue albo maxValue,
  // min = max → value, okres wyłącznie z danych.
  const salary = normalizeSalary(job);
  const unitText = salary?.period ? SALARY_UNIT[salary.period] : undefined;
  const baseSalary = salary
    ? {
        '@type': 'MonetaryAmount',
        currency: salary.currency,
        value: {
          '@type': 'QuantitativeValue',
          ...(salary.min !== undefined && salary.min === salary.max
            ? { value: salary.min }
            : {
                ...(salary.min !== undefined ? { minValue: salary.min } : {}),
                ...(salary.max !== undefined ? { maxValue: salary.max } : {}),
              }),
          ...(unitText ? { unitText } : {}),
        },
      }
    : undefined;

  // Linki firmy tylko jako bezpieczny https (baza zwraca je wyłącznie dla firmy verified).
  const sameAs = publicHttpsUrl(job.companyWebsite);
  const logo = publicHttpsUrl(job.companyLogoUrl);

  const telecommute = telecommuteFields(job);

  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: buildJobPostingDescription(job, labels),
    identifier: {
      '@type': 'PropertyValue',
      name: job.companyName,
      value: job.id,
      propertyID: job.slug,
    },
    datePosted: job.publishedAt,
    ...(validThrough ? { validThrough } : {}),
    // #842 — bez potwierdzonego wymiaru pracy (`permanent`) pole jest pomijane, nie zgadywane;
    // #811 — zadeklarowany wymiar (FULL_TIME/PART_TIME) + kategoria z rodzaju umowy.
    ...(() => {
      const types = employmentTypes(job);
      if (types.length === 0) return {};
      return { employmentType: types.length === 1 ? types[0] : types };
    })(),
    hiringOrganization: {
      '@type': 'Organization',
      name: job.companyName,
      ...(sameAs ? { sameAs } : {}),
      ...(logo ? { logo } : {}),
    },
    // #792: praca w 100% zdalna = TELECOMMUTE + kraje kandydata, bez fizycznego `jobLocation`.
    ...(telecommute ?? {
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: job.city,
          addressRegion: job.region,
          addressCountry: 'BE',
        },
      },
    }),
    ...(baseSalary ? { baseSalary } : {}),
    ...(job.startDate ? { jobStartDate: job.startDate } : {}),
    ...(options.jobBenefits?.trim() ? { jobBenefits: options.jobBenefits.trim() } : {}),
    url,
    directApply: options.directApply ?? true,
  };
}

export interface ArticleInput {
  title: string;
  excerpt: string;
  publishedAt: string;
  /** Data ostatniej zmiany treści; brak = treść bez zmian od publikacji. */
  updatedAt?: string;
}

/** Article dla poradnika: obraz marki, `dateModified`, autor/wydawca z adresem i logo. */
export function buildArticleJsonLd(
  guide: ArticleInput,
  { base, locale, canonical }: { base: string; locale: string; canonical: string },
): Record<string, unknown> {
  const siteUrl = new URL(`/${locale}`, base).href;
  const organization = { '@type': 'Organization', name: BRAND_NAME, url: siteUrl };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.excerpt,
    image: [brandShareImageUrl(base)],
    datePublished: guide.publishedAt,
    dateModified: guide.updatedAt ?? guide.publishedAt,
    inLanguage: locale,
    author: organization,
    publisher: {
      ...organization,
      logo: { '@type': 'ImageObject', url: new URL(BRAND_LOGO_PATH, base).href, width: 512, height: 512 },
    },
    mainEntityOfPage: canonical,
  };
}

export interface OrganizationInput {
  name: string;
  description?: string;
  city?: string;
  region?: string;
  website?: string;
  logoUrl?: string;
}

/**
 * Organization dla publicznego profilu firmy `/pracodawcy/<slug>` (#591). Strona istnieje
 * wyłącznie dla firmy zweryfikowanej (`get_public_company`), więc dane nie opisują firm
 * niezweryfikowanych. `url` = kanoniczny adres profilu; strona WWW (`sameAs`) i logo tylko
 * jako bezpieczny https — jak `hiringOrganization` w JobPosting (drugi filtr po bazie).
 */
export function buildOrganizationJsonLd(company: OrganizationInput, url: string): Record<string, unknown> {
  const sameAs = publicHttpsUrl(company.website);
  const logo = publicHttpsUrl(company.logoUrl);
  const description = company.description?.trim();
  const address =
    company.city || company.region
      ? {
          '@type': 'PostalAddress',
          ...(company.city ? { addressLocality: company.city } : {}),
          ...(company.region ? { addressRegion: company.region } : {}),
          addressCountry: 'BE',
        }
      : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.name,
    url,
    ...(description ? { description } : {}),
    ...(sameAs ? { sameAs } : {}),
    ...(logo ? { logo } : {}),
    ...(address ? { address } : {}),
  };
}

/** Pozycja ścieżki nawigacji — ten sam kształt co `BreadcrumbItem` komponentu `Breadcrumbs`. */
export interface BreadcrumbTrailItem {
  label: string;
  /** Ścieżka bez prefiksu języka (`/`, `/praca`…); brak = bieżąca strona (ostatnia pozycja). */
  href?: string;
}

/**
 * BreadcrumbList z tej samej listy pozycji co widoczna ścieżka `Breadcrumbs` — dane
 * strukturalne nie rozjeżdżają się z nawigacją. Ścieżki dostają prefiks języka strony
 * (`/` → strona główna języka), ostatnia pozycja bez `href` = `currentUrl` (adres bieżącej
 * strony). Pozycja bez nazwy jest pomijana (Google wymaga `name`); pośrednia pozycja bez
 * `href` nie dostaje `item` (schema.org dopuszcza brak `item` tylko dla ostatniej — wywołujący
 * podaje `href` każdej pozycji poza bieżącą).
 */
export function buildBreadcrumbListJsonLd(
  items: readonly BreadcrumbTrailItem[],
  { base, locale, currentUrl }: { base: string; locale: string; currentUrl: string },
): Record<string, unknown> {
  const named = items
    .map((entry) => ({ ...entry, label: entry.label.trim() }))
    .filter((entry) => entry.label.length > 0);
  return {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: named.map((entry, index) => {
      const isLast = index === named.length - 1;
      const url = entry.href
        ? new URL(`/${locale}${entry.href === '/' ? '' : entry.href}`, base).href
        : isLast
          ? currentUrl
          : undefined;
      return {
        '@type': 'ListItem',
        position: index + 1,
        name: entry.label,
        ...(url ? { item: url } : {}),
      };
    }),
  };
}
