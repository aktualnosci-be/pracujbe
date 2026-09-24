/**
 * Dane strukturalne (schema.org JSON-LD) i wspólny obraz marki do metadanych publicznych stron.
 *
 * Czyste funkcje bez i18n i bez env: nagłówki sekcji opisu oferty oraz bazowy URL przychodzą
 * z wywołującego (strona serwerowa), dzięki czemu reguły (#313) są testowane jednostkowo.
 */

import type { ContractType, JobDetail } from '@/lib/jobs';

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

/** Mapowanie rodzaju umowy na schema.org employmentType. */
const EMPLOYMENT_TYPE: Record<ContractType, string> = {
  permanent: 'FULL_TIME',
  temporary: 'TEMPORARY',
  interim: 'TEMPORARY',
  freelance: 'CONTRACTOR',
  internship: 'INTERN',
  seasonal: 'TEMPORARY',
};

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
 */
export function buildJobPostingJsonLd(
  job: JobDetail,
  url: string,
  labels: JobPostingLabels,
): Record<string, unknown> {
  const expiresTs = job.expiresAt ? Date.parse(job.expiresAt) : Number.NaN;
  const validThrough = Number.isNaN(expiresTs) ? undefined : new Date(expiresTs).toISOString();

  const unitText = job.salaryPeriod ? SALARY_UNIT[job.salaryPeriod] : undefined;
  const hasSalary = job.salaryMin !== undefined || job.salaryMax !== undefined;
  const baseSalary = hasSalary
    ? {
        '@type': 'MonetaryAmount',
        currency: job.currency,
        value: {
          '@type': 'QuantitativeValue',
          ...(job.salaryMin !== undefined ? { minValue: job.salaryMin } : {}),
          ...(job.salaryMax !== undefined ? { maxValue: job.salaryMax } : {}),
          ...(unitText ? { unitText } : {}),
        },
      }
    : undefined;

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
    employmentType: EMPLOYMENT_TYPE[job.contractType],
    hiringOrganization: {
      '@type': 'Organization',
      name: job.companyName,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: job.city,
        addressRegion: job.region,
        addressCountry: 'BE',
      },
    },
    ...(baseSalary ? { baseSalary } : {}),
    ...(job.startDate ? { jobStartDate: job.startDate } : {}),
    url,
    directApply: false,
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
