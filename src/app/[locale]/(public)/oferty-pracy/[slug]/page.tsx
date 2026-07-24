import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Heart,
  Home,
  Languages as LanguagesIcon,
  MapPin,
  MessageSquare,
  Truck,
  Wallet,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobBySlug, getJobs, type ContractType, type JobDetail, type JobListItem } from '@/lib/jobs';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { ApplyModal } from '@/components/public/ApplyModal';
import { JobMatchCard } from '@/components/public/JobMatchCard';

/**
 * Szczegóły oferty pracy (SSR) wg makiety 03-job-detail.
 *
 * Nagłówek z meta-danymi, zakładki (kotwice do sekcji), treść (opis / obowiązki / wymagania /
 * oferujemy / zakwaterowanie / o firmie) oraz przyklejony prawy panel (Aplikuj teraz + kontakt
 * + podobne oferty). Na mobile sekcje są akordeonami (`<details>`), a aplikowanie odbywa się
 * z przyklejonego dolnego paska. Zachowane pełne metadane SEO oraz dane strukturalne
 * JobPosting (JSON-LD).
 *
 * Uwaga na Invariant #8: nie fabrykujemy danych osobowych kontaktu ani ocen — kontakt jest
 * generyczny (przez platformę), a aplikowanie/zapis wymagają konta (logowanie).
 *
 * TODO(i18n-slugs): jeden segment `oferty-pracy` dla wszystkich języków; lokalizowane slugi
 * w mapie drogowej (spec 12).
 * TODO(company-page): „Dowiedz się więcej o firmie” prowadzi tymczasowo do ofert firmy
 * (wyszukiwarka), docelowo do dedykowanej strony firmy.
 */

const BASE_PATH = '/oferty-pracy';
const LOGIN_HREF = '/logowanie';

/** Mapowanie locale aplikacji → locale Open Graph (format język_KRAJ). Spójne z layoutem/stroną główną. */
const OG_LOCALE: Record<string, string> = {
  pl: 'pl_PL',
  nl: 'nl_BE',
  fr: 'fr_BE',
  en: 'en_GB',
};
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_DAYS = 60;
const SIMILAR_LIMIT = 3;

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

function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return letters || '•';
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
      locale: OG_LOCALE[locale] ?? locale,
      publishedTime: job.publishedAt,
    },
  };
}

function buildJsonLd(job: JobDetail, url: string): Record<string, unknown> {
  // P1-12: validThrough z REALNEGO expires_at oferty; fallback (brak daty) = datePosted + 60 dni.
  const publishedTs = Date.parse(job.publishedAt);
  const validThrough = job.expiresAt
    ? job.expiresAt
    : Number.isNaN(publishedTs)
      ? undefined
      : new Date(publishedTs + VALID_DAYS * DAY_MS).toISOString();

  // P1-12: unitText z realnego okresu pensji (godzina/miesiąc/rok), nie na sztywno „MONTH".
  const SALARY_UNIT: Record<NonNullable<JobDetail['salaryPeriod']>, string> = {
    hour: 'HOUR',
    month: 'MONTH',
    year: 'YEAR',
  };
  const unitText = SALARY_UNIT[job.salaryPeriod ?? 'month'];

  const hasSalary = job.salaryMin !== undefined || job.salaryMax !== undefined;
  const baseSalary = hasSalary
    ? {
        '@type': 'MonetaryAmount',
        currency: job.currency,
        value: {
          '@type': 'QuantitativeValue',
          ...(job.salaryMin !== undefined ? { minValue: job.salaryMin } : {}),
          ...(job.salaryMax !== undefined ? { maxValue: job.salaryMax } : {}),
          unitText,
        },
      }
    : undefined;

  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: [job.description, ...job.responsibilities].join(' '),
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

export default async function JobDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const job = await getJobBySlug(slug, locale);
  if (!job) {
    notFound();
  }

  const [t, tJobs, tContract, tCategory, tCommon, tApply, format] = await Promise.all([
    getTranslations('job'),
    getTranslations('jobs'),
    getTranslations('contractTypes'),
    getTranslations('categories'),
    getTranslations('common'),
    getTranslations('apply'),
    getFormatter(),
  ]);

  const currencyOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: job.currency,
    maximumFractionDigits: 0,
  };
  const salaryLabel = (() => {
    if (job.salaryMin !== undefined && job.salaryMax !== undefined) {
      return `${format.number(job.salaryMin, currencyOptions)} – ${format.number(job.salaryMax, currencyOptions)}`;
    }
    const single = job.salaryMin ?? job.salaryMax;
    return single !== undefined ? format.number(single, currencyOptions) : t('salaryNotProvided');
  })();

  const publishedLabel = format.dateTime(new Date(job.publishedAt), { dateStyle: 'long' });

  const url = `${env.siteUrl}/${locale}${BASE_PATH}/${slug}`;
  const jsonLd = buildJsonLd(job, url);

  // Podobne oferty (ta sama kategoria, bez bieżącej).
  const similarResult = await getJobs({
    locale,
    category: job.category,
    page: 1,
    pageSize: SIMILAR_LIMIT + 1,
  });
  const similarJobs: JobListItem[] = similarResult.jobs
    .filter((item) => item.slug !== job.slug)
    .slice(0, SIMILAR_LIMIT);

  const metaItems: Array<{ icon: React.ComponentType<{ className?: string }>; text: string }> = [
    { icon: MapPin, text: `${job.city}, ${job.region}` },
    { icon: Wallet, text: salaryLabel },
    { icon: FileText, text: tContract(job.contractType) },
    { icon: Clock, text: job.workingHours },
  ];
  if (job.shifts) metaItems.push({ icon: Clock, text: job.shifts });

  const applyLabel = tJobs('applyNow');
  const applyHint = tApply('hint');

  const tabs = [
    { href: '#opis', label: t('tabDescription') },
    { href: '#firma', label: t('tabCompany') },
    { href: '#podobne', label: t('tabSimilar') },
  ];

  const Section = ({
    id,
    title,
    children,
  }: {
    id?: string;
    title: string;
    children: React.ReactNode;
  }): React.JSX.Element => (
    <details
      id={id}
      open
      className="group border-b border-border py-4 first:pt-0 lg:border-0 lg:py-0"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 lg:pointer-events-none lg:cursor-default [&::-webkit-details-marker]:hidden">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 lg:hidden"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-3 lg:mt-4">{children}</div>
    </details>
  );

  const companyLogo = (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
      aria-hidden="true"
    >
      {initials(job.companyName)}
    </div>
  );

  return (
    <div className="container py-6 md:py-10">
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
        {t('backToResults')}
      </Link>

      {/* Nagłówek */}
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              {job.title}
            </h1>
            <div className="mt-3 flex items-center gap-3">
              {companyLogo}
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
                  {job.companyName}
                  {job.companyVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text">
                      <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                      {t('verified')}
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tCategory(job.category)}
                </p>
              </div>
            </div>
          </div>

          {/* Zapisz (desktop) */}
          <Link
            href={LOGIN_HREF}
            className={cn(buttonVariants({ variant: 'outline' }), 'hidden lg:inline-flex')}
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            {t('saveJob')}
          </Link>
        </div>

        {/* Meta */}
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {metaItems.map((item, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.text}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('publishedOn')} {publishedLabel}
          </span>
        </div>
      </header>

      {/* Zakładki (kotwice do sekcji) */}
      <nav aria-label={t('tabDescription')} className="mb-6 border-b border-border">
        <ul className="-mb-px flex flex-wrap gap-6">
          {tabs.map((tab, index) => (
            <li key={tab.href}>
              <a
                href={tab.href}
                aria-current={index === 0 ? 'true' : undefined}
                className={cn(
                  'inline-block border-b-2 pb-3 text-sm font-medium transition-colors',
                  index === 0
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Treść */}
        <div className="lg:col-span-2 lg:space-y-8">
          <Section id="opis" title={t('aboutRole')}>
            <p className="whitespace-pre-line leading-relaxed text-foreground">{job.description}</p>
          </Section>

          {job.responsibilities.length > 0 ? (
            <Section title={t('responsibilities')}>
              <ul className="space-y-2">
                {job.responsibilities.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {job.requirementsMandatory.length > 0 || job.requirementsOptional.length > 0 ? (
            <Section title={t('requirementsMandatory')}>
              <ul className="space-y-2">
                {job.requirementsMandatory.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              {job.requirementsOptional.length > 0 ? (
                <>
                  <h3 className="mb-2 mt-4 text-sm font-semibold text-muted-foreground">
                    {t('requirementsOptional')}
                  </h3>
                  <ul className="space-y-2">
                    {job.requirementsOptional.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <span
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="text-muted-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Section>
          ) : null}

          {job.conditions.length > 0 ? (
            <Section title={t('conditions')}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {job.conditions.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={t('accommodationCommute')}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-2.5">
                <Home className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-sm text-muted-foreground">{t('accommodation')}</dt>
                  <dd className="font-medium text-foreground">
                    {job.accommodation ? tCommon('yes') : tCommon('no')}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Truck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-sm text-muted-foreground">{t('transport')}</dt>
                  <dd className="font-medium text-foreground">
                    {job.transport ? tCommon('yes') : tCommon('no')}
                  </dd>
                </div>
              </div>
              {job.languages.length > 0 ? (
                <div className="flex items-start gap-2.5">
                  <LanguagesIcon
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <dt className="text-sm text-muted-foreground">{t('languages')}</dt>
                    <dd className="font-medium text-foreground">{job.languages.join(', ')}</dd>
                  </div>
                </div>
              ) : null}
            </dl>
          </Section>

          {/* Informacje o firmie */}
          <Section id="firma" title={t('aboutCompany')}>
            <div className="rounded-lg border border-border bg-soft p-5">
              <div className="flex items-center gap-3">
                {companyLogo}
                <div>
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    {job.companyName}
                    {job.companyVerified ? (
                      <BadgeCheck className="h-4 w-4 text-success" aria-hidden="true" />
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('industry')}: {tCategory(job.category)}
                  </p>
                </div>
              </div>
              <p className="mt-3 leading-relaxed text-muted-foreground">{job.companyDescription}</p>
              <Link
                href={`${BASE_PATH}?keyword=${encodeURIComponent(job.companyName)}`}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-dark"
              >
                {t('learnMoreCompany')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </Section>
        </div>

        {/* Panel boczny */}
        <aside className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-24">
            {/* Dopasowanie do profilu (tylko dla zalogowanego kandydata; wyspa kliencka) */}
            <JobMatchCard jobId={job.id} />

            {/* Aplikuj (desktop — mobile ma dolny pasek) */}
            <div className="hidden rounded-lg border border-border bg-card p-5 shadow-sm lg:block">
              <ApplyModal
                jobId={job.id}
                companyName={job.companyName}
                triggerLabel={applyLabel}
                triggerHint={applyHint}
                triggerClassName="w-full"
              />
              <Link
                href={LOGIN_HREF}
                className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 w-full')}
              >
                <Heart className="h-4 w-4" aria-hidden="true" />
                {t('saveJob')}
              </Link>
            </div>

            {/* Kontakt */}
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-foreground">{t('contactTitle')}</h2>
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{job.companyName}</p>
                  <p className="text-sm text-muted-foreground">{t('contactViaPlatform')}</p>
                </div>
              </div>
              {job.languages.length > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('languages')}: {job.languages.join(', ')}
                </p>
              ) : null}
              <Link
                href={LOGIN_HREF}
                className={cn(buttonVariants({ variant: 'outline' }), 'mt-4 w-full')}
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                {t('sendMessage')}
              </Link>
            </div>

            {/* Podobne oferty */}
            {similarJobs.length > 0 ? (
              <div id="podobne" className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-foreground">{t('similarJobs')}</h2>
                <ul className="divide-y divide-border">
                  {similarJobs.map((item) => {
                    const itemSalary =
                      item.salaryMin !== undefined && item.salaryMax !== undefined
                        ? `${format.number(item.salaryMin, { style: 'currency', currency: item.currency, maximumFractionDigits: 0 })} – ${format.number(item.salaryMax, { style: 'currency', currency: item.currency, maximumFractionDigits: 0 })}`
                        : null;
                    return (
                      <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                        <Link href={`${BASE_PATH}/${item.slug}`} className="group flex gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                            aria-hidden="true"
                          >
                            {initials(item.companyName)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground group-hover:text-accent">
                              {item.title}
                            </p>
                            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3" aria-hidden="true" />
                              {item.city}
                            </p>
                            {itemSalary ? (
                              <p className="mt-0.5 text-xs font-medium text-foreground">{itemSalary}</p>
                            ) : null}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Link
                  href={`${BASE_PATH}?category=${job.category}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-dark"
                >
                  {t('seeMoreJobs')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {/* Dolny pasek (mobile) */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-background/95 p-3 shadow-[0_-4px_12px_rgba(15,42,71,0.08)] backdrop-blur lg:hidden">
        <Link
          href={LOGIN_HREF}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
        >
          <Heart className="h-4 w-4" aria-hidden="true" />
          {t('saveJob')}
        </Link>
        <ApplyModal
          jobId={job.id}
          companyName={job.companyName}
          triggerLabel={applyLabel}
          triggerSize="default"
          triggerClassName="flex-1"
        />
      </div>
      {/* Odstęp, aby dolny pasek nie zasłaniał treści na mobile. */}
      <div className="h-20 lg:hidden" aria-hidden="true" />
    </div>
  );
}
