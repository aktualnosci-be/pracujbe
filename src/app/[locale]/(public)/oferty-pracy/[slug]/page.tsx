import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Home,
  Languages as LanguagesIcon,
  MapPin,
  Truck,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobBySlug, type ContractType, type JobDetail } from '@/lib/jobs';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

/**
 * Szczegóły oferty pracy (SSR). Dane z `getJobBySlug` (DB lub demo). Brak oferty → 404.
 * Zawiera pełne metadane SEO (canonical, hreflang, OpenGraph) oraz dane strukturalne
 * JobPosting (JSON-LD). Na desktopie panel „Aplikuj” jest przyklejony z boku; na mobile
 * przycisk aplikowania jest dostępny w nagłówku (nie zasłania treści).
 *
 * TODO(i18n-slugs): jeden segment `oferty-pracy` dla wszystkich języków; lokalizowane
 * slugi (vacatures/offres-emploi/jobs) w mapie drogowej (spec 12).
 * TODO(apply-flow): przycisk „Aplikuj” prowadzi tymczasowo do logowania — właściwy
 * formularz aplikacji dostarcza moduł kandydata.
 */

const BASE_PATH = '/oferty-pracy';
const APPLY_HREF = '/logowanie';
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_DAYS = 60;

/** Mapowanie rodzaju umowy na schema.org employmentType. */
const EMPLOYMENT_TYPE: Record<ContractType, string> = {
  permanent: 'FULL_TIME',
  temporary: 'TEMPORARY',
  interim: 'TEMPORARY',
  freelance: 'CONTRACTOR',
  internship: 'INTERN',
  seasonal: 'TEMPORARY',
};

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const job = await getJobBySlug(slug, locale);
  if (!job) {
    return { robots: { index: false, follow: false } };
  }

  const base = env.siteUrl;
  const path = `${BASE_PATH}/${slug}`;
  const url = `${base}/${locale}${path}`;
  const description = truncate(job.description, 160);

  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  return {
    title: job.title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title: job.title,
      description,
      url,
      siteName: 'Pracuj.be',
      type: 'article',
      locale,
      publishedTime: job.publishedAt,
    },
  };
}

function buildJsonLd(job: JobDetail, url: string): Record<string, unknown> {
  const publishedTs = Date.parse(job.publishedAt);
  const validThrough = Number.isNaN(publishedTs)
    ? undefined
    : new Date(publishedTs + VALID_DAYS * DAY_MS).toISOString();

  const hasSalary = job.salaryMin !== undefined || job.salaryMax !== undefined;
  const baseSalary = hasSalary
    ? {
        '@type': 'MonetaryAmount',
        currency: job.currency,
        value: {
          '@type': 'QuantitativeValue',
          ...(job.salaryMin !== undefined ? { minValue: job.salaryMin } : {}),
          ...(job.salaryMax !== undefined ? { maxValue: job.salaryMax } : {}),
          unitText: 'MONTH',
        },
      }
    : undefined;

  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: [job.description, ...job.responsibilities].join(' '),
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

export default async function JobDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const job = await getJobBySlug(slug, locale);
  if (!job) {
    notFound();
  }

  const [t, tJobs, tContract, tCategory, tCommon, format] = await Promise.all([
    getTranslations('job'),
    getTranslations('jobs'),
    getTranslations('contractTypes'),
    getTranslations('categories'),
    getTranslations('common'),
    getFormatter(),
  ]);

  const currencyOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: job.currency,
    maximumFractionDigits: 0,
  };

  const salaryLabel = (() => {
    if (job.salaryMin !== undefined && job.salaryMax !== undefined) {
      return `${format.number(job.salaryMin, currencyOptions)} – ${format.number(
        job.salaryMax,
        currencyOptions,
      )}`;
    }
    const single = job.salaryMin ?? job.salaryMax;
    return single !== undefined ? format.number(single, currencyOptions) : t('salaryNotProvided');
  })();

  const publishedLabel = format.dateTime(new Date(job.publishedAt), { dateStyle: 'long' });
  const startDateLabel = job.startDate
    ? format.dateTime(new Date(job.startDate), { dateStyle: 'long' })
    : job.immediate
      ? tJobs('immediate')
      : undefined;

  const url = `${env.siteUrl}/${locale}${BASE_PATH}/${slug}`;
  const jsonLd = buildJsonLd(job, url);

  const applyButton = (
    <Link href={APPLY_HREF} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
      {t('apply')}
    </Link>
  );

  return (
    <div className="container py-8 md:py-12">
      <script
        type="application/ld+json"
        // Escapowanie „<" chroni przed wyjściem z tagu <script> dla danych z bazy.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <Link
        href={BASE_PATH}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('backToList')}
      </Link>

      {/* Nagłówek */}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{tContract(job.contractType)}</Badge>
          <Badge variant="outline">{tCategory(job.category)}</Badge>
          {job.isNew ? <Badge variant="success">{tJobs('newBadge')}</Badge> : null}
        </div>

        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{job.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {job.companyName}
            {job.companyVerified ? (
              <span className="inline-flex items-center gap-1 text-success" title={t('verified')}>
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('verified')}</span>
              </span>
            ) : null}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {job.city}, {job.region}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t('publishedOn')} {publishedLabel}
          </span>
        </div>

        {job.highlights.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {job.highlights.map((highlight) => (
              <Badge key={highlight} variant="outline">
                {highlight}
              </Badge>
            ))}
          </div>
        ) : null}

        {/* CTA mobilne — dostępne, nie zasłania treści (brak sticky/fixed) */}
        <div className="mt-6 lg:hidden">{applyButton}</div>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Treść główna */}
        <div className="space-y-8 lg:col-span-2">
          <section>
            <h2 className="mb-3 text-xl font-semibold">{t('aboutRole')}</h2>
            <p className="whitespace-pre-line leading-relaxed text-foreground">{job.description}</p>
          </section>

          {job.responsibilities.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('responsibilities')}</h2>
              <ul className="space-y-2">
                {job.responsibilities.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {job.requirementsMandatory.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('requirementsMandatory')}</h2>
              <ul className="space-y-2">
                {job.requirementsMandatory.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {job.requirementsOptional.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('requirementsOptional')}</h2>
              <ul className="space-y-2">
                {job.requirementsOptional.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {job.conditions.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('conditions')}</h2>
              <ul className="space-y-2">
                {job.conditions.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-5 w-5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Szczegóły pracy */}
          <section>
            <h2 className="mb-3 text-xl font-semibold">{t('workingHours')}</h2>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-sm text-muted-foreground">{t('workingHours')}</dt>
                  <dd className="font-medium">{job.workingHours}</dd>
                </div>
              </div>

              {job.shifts ? (
                <div className="flex items-start gap-2">
                  <Clock
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <dt className="text-sm text-muted-foreground">{t('shifts')}</dt>
                    <dd className="font-medium">{job.shifts}</dd>
                  </div>
                </div>
              ) : null}

              <div className="flex items-start gap-2">
                <LanguagesIcon
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div>
                  <dt className="text-sm text-muted-foreground">{t('languages')}</dt>
                  <dd className="font-medium">
                    {job.languages.length > 0 ? job.languages.join(', ') : '—'}
                  </dd>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Home className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-sm text-muted-foreground">{t('accommodation')}</dt>
                  <dd className="font-medium">{job.accommodation ? tCommon('yes') : tCommon('no')}</dd>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Truck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-sm text-muted-foreground">{t('transport')}</dt>
                  <dd className="font-medium">{job.transport ? tCommon('yes') : tCommon('no')}</dd>
                </div>
              </div>

              {startDateLabel ? (
                <div className="flex items-start gap-2">
                  <CalendarDays
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <dt className="text-sm text-muted-foreground">{t('startDate')}</dt>
                    <dd className="font-medium">{startDateLabel}</dd>
                  </div>
                </div>
              ) : null}
            </dl>
          </section>

          {/* O firmie */}
          <section>
            <h2 className="mb-3 text-xl font-semibold">{t('aboutCompany')}</h2>
            <div className="flex items-center gap-2">
              <span className="font-medium">{job.companyName}</span>
              {job.companyVerified ? (
                <Badge variant="success" className="gap-1">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('verified')}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 leading-relaxed text-muted-foreground">{job.companyDescription}</p>
          </section>
        </div>

        {/* Panel boczny (desktop, sticky) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
            <div>
              <p className="text-sm text-muted-foreground">{t('company')}</p>
              <p className="font-semibold">{job.companyName}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">{tJobs('salary')}</p>
              <p className="text-lg font-bold text-foreground">{salaryLabel}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">{t('location')}</p>
              <p className="font-medium">
                {job.city}, {job.region}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{tContract(job.contractType)}</Badge>
              {job.accommodation ? <Badge variant="outline">{t('accommodation')}</Badge> : null}
              {job.transport ? <Badge variant="outline">{t('transport')}</Badge> : null}
              {job.immediate ? <Badge variant="outline">{tJobs('immediate')}</Badge> : null}
            </div>

            <div className="pt-2">{applyButton}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
