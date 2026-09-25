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
 * warstwa po `public_https_url` w bazie (0108) — dane mogą też przyjść z innego źródła.
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
      ...(sameAs ? { sameAs } : {}),
      ...(logo ? { logo } : {}),
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
