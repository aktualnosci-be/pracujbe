import { formatSalaryRange } from '@/lib/salary';
import { PublicSavedJobsProvider, PublicSaveJobButton } from '@/components/public/PublicSavedJobs';
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
  Home,
  Languages as LanguagesIcon,
  MapPin,
  MessageSquare,
  Truck,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import { buildJobDetailPassportFields } from '@/lib/job-detail-passport';
import { defaultAlternateLocale } from '@/lib/job-content-locale';
import { getJobBySlug, getSimilarJobs, type JobDetail } from '@/lib/jobs';
import { brandShareImageUrl, buildJobPostingJsonLd, serializeJsonLd } from '@/lib/seo/structured-data';
import { cn } from '@/lib/utils';
import {
  EYEBROW,
  H1_EXTENDED,
  H2_EXTENDED,
  H3_EXTENDED,
  INTRO,
  P_EXTENDED,
  PAPER,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { buttonVariants } from '@/components/ui/button';
import { ApplyModal } from '@/components/public/ApplyModal';
import { JobFunnelBeacon } from '@/components/public/JobFunnelBeacon';
import { loginHref } from '@/lib/auth/next-path';
import { JobMatchCard } from '@/components/public/JobMatchCard';
import { JobCompanyBlockControl } from '@/components/public/JobCompanyBlockControl';
import { SimilarJobsError } from '@/components/public/SimilarJobsError';
import { DemoJobsNotice } from '@/components/public/DemoJobsNotice';

/**
 * Szczegóły oferty pracy (SSR) wg makiety 03-job-detail.
 *
 * Nagłówek z meta-danymi, zakładki (kotwice do sekcji), treść (opis / obowiązki / wymagania /
 * oferujemy / zakwaterowanie / o firmie) oraz przyklejony prawy panel (Aplikuj teraz + kontakt
 * + podobne oferty). Na mobile sekcje są akordeonami (`<details>`), a aplikowanie odbywa się
 * z przyklejonego dolnego paska. Zachowane pełne metadane SEO oraz dane strukturalne
 * JobPosting (JSON-LD).
 *
 * Oferta demonstracyjna (#297, `job.isDemo`): baner „dane przykładowe”, bez odznaki
 * weryfikacji, bez JobPosting, noindex i modal z komunikatem zamiast formularza aplikacji.
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

/** Mapowanie locale aplikacji → locale Open Graph (format język_KRAJ). Spójne z layoutem/stroną główną. */
const OG_LOCALE: Record<string, string> = {
  pl: 'pl_PL',
  nl: 'nl_BE',
  fr: 'fr_BE',
  en: 'en_GB',
};
const SIMILAR_LIMIT = 3;

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

/**
 * Wersja językowa oferty (#301). `fallback` = strona w języku, dla którego oferta nie ma
 * tłumaczenia (treść w innym języku). Taka wersja wskazuje canonical na język oryginału i nie
 * należy do zbioru hreflang. Nieznane języki tłumaczeń = zachowanie jak dla pełnej oferty.
 */
function contentLanguage(job: JobDetail, locale: string): {
  fallback: boolean;
  contentLocale?: Locale;
  canonicalLocale: string;
  alternates: readonly Locale[];
} {
  const available = job.availableLocales;
  if (!available || available.length === 0) {
    return { fallback: false, canonicalLocale: locale, alternates: routing.locales };
  }
  const fallback = !(available as readonly string[]).includes(locale);
  const contentLocale = fallback ? (job.contentLocale ?? defaultAlternateLocale(available)) : undefined;
  return {
    fallback,
    contentLocale,
    canonicalLocale: contentLocale ?? locale,
    alternates: available,
  };
}

/**
 * ISR (#298): szczegół oferty powstaje przy pierwszym żądaniu (pusta lista parametrów — build
 * nie czyta ofert z bazy) i jest odświeżany co 60 s, więc zamknięta oferta znika najpóźniej
 * po minucie. Strona nie czyta sesji: dopasowanie, zapisywanie i aplikowanie to wyspy klienckie.
 */
export const revalidate = 60;

export function generateStaticParams(): Array<{ locale: string; slug: string }> {
  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const job = await getJobBySlug(slug, locale);
  if (!job) {
    return { robots: { index: false, follow: false } };
  }

  const base = env.siteUrl;
  const path = `${BASE_PATH}/${slug}`;
  const version = contentLanguage(job, locale);
  // Wersja bez tłumaczenia kanonizuje się do języka oryginału (bez duplikatów treści, #301).
  const url = `${base}/${version.canonicalLocale}${path}`;
  const description = truncate(job.description, 160);
  const shareImage = brandShareImageUrl(base);

  // hreflang tylko dla języków z tłumaczeniem; strona fallback nie należy do tego zbioru.
  const languages: Record<string, string> = {};
  const xDefault = defaultAlternateLocale(version.alternates);
  if (!version.fallback) {
    for (const supported of version.alternates) {
      languages[supported] = `${base}/${supported}${path}`;
    }
    if (xDefault) languages['x-default'] = `${base}/${xDefault}${path}`;
  }

  return {
    title: job.title,
    description,
    // Fikcyjna oferta demo nie trafia do indeksu (#297).
    ...(job.isDemo ? { robots: { index: false, follow: true } } : {}),
    alternates: version.fallback ? { canonical: url } : { canonical: url, languages },
    openGraph: {
      title: job.title,
      description,
      url,
      siteName: 'Pracuj.be',
      type: 'article',
      locale: OG_LOCALE[version.canonicalLocale] ?? version.canonicalLocale,
      publishedTime: job.publishedAt,
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: job.title,
      description,
      images: [shareImage],
    },
  };
}

export default async function JobDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const job = await getJobBySlug(slug, locale);
  if (!job) {
    notFound();
  }

  const [t, tJobs, tContract, tCategory, tCommon, tApply, tReport, format] = await Promise.all([
    getTranslations('job'),
    getTranslations('jobs'),
    getTranslations('contractTypes'),
    getTranslations('categories'),
    getTranslations('common'),
    getTranslations('apply'),
    getTranslations('contentReport'),
    getFormatter(),
  ]);

  const passportFields = buildJobDetailPassportFields(job, locale, {
    location: tJobs('passport.location'),
    salary: tJobs('passport.salary'),
    conditions: tJobs('passport.conditions'),
    contract: type => tContract(type),
    salaryFrom: value => tJobs('passport.salaryFrom', { value }),
    salaryTo: value => tJobs('passport.salaryTo', { value }),
    salaryPeriod: period => tJobs(`passport.salaryPeriods.${period}`),
  });

  const publishedLabel = format.dateTime(new Date(job.publishedAt), { dateStyle: 'long' });

  const url = `${env.siteUrl}/${locale}${BASE_PATH}/${slug}`;
  const version = contentLanguage(job, locale);
  // JobPosting tylko na wersji kanonicznej — wersja bez tłumaczenia nie powiela danych (#301).
  // Fikcyjna oferta demo nie udaje ogłoszenia o pracę w danych strukturalnych (#297).
  const jsonLd = version.fallback || job.isDemo
    ? null
    : buildJobPostingJsonLd(job, url, {
        responsibilities: t('responsibilities'),
        requirementsMandatory: t('requirementsMandatory'),
        requirementsOptional: t('requirementsOptional'),
        conditions: t('conditions'),
        workingHours: t('workingHours'),
        shifts: t('shifts'),
      });
  // Treść w innym języku niż strona → `lang` na fragmentach treści (WCAG 3.1.2).
  const contentLang = version.fallback ? version.contentLocale : undefined;

  // Podobne oferty (ta sama kategoria, bez bieżącej). Sekcja pomocnicza: jej błąd odczytu
  // nie przerywa strony — opis, firma i aplikowanie zostają dostępne (#191).
  const similar = await getSimilarJobs(job, locale, SIMILAR_LIMIT);
  const similarJobs = similar.status === 'ok' ? similar.jobs : [];
  const showSimilar = similar.status === 'error' || similarJobs.length > 0;

  const applyLabel = tJobs('applyNow');
  const applyHint = tApply('hint');

  const tabs = [
    { href: '#opis', label: t('tabDescription') },
    { href: '#firma', label: t('tabCompany') },
    // Kotwica „Podobne” tylko, gdy sekcja istnieje (inaczej martwy link).
    ...(showSimilar ? [{ href: '#podobne', label: t('tabSimilar') }] : []),
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
      className="group border-b border-[color:var(--pp-line)] py-4 first:pt-0 last:border-b-0 last:pb-0 lg:border-0 lg:py-0"
    >
      {/*
        Akordeon tylko na mobile: na `lg` summary znika (display:none), więc nie jest
        przystankiem Tab i Enter/Spacja nie zwinie sekcji, której nie da się rozwinąć myszą.
        Na desktopie nagłówek sekcji to osobny `h2` za summary (w drzewie a11y zawsze tylko
        jeden z nich).
      */}
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 lg:hidden [&::-webkit-details-marker]:hidden">
        <h2 className={H2_EXTENDED}>{title}</h2>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 lg:hidden"
          aria-hidden="true"
        />
      </summary>
      <h2 className={cn(H2_EXTENDED, 'hidden lg:block')}>{title}</h2>
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
    <PublicSavedJobsProvider key={JSON.stringify([job.id])} jobIds={[job.id]}>
    <div className="container py-10 max-[600px]:py-[25px]">
      {jsonLd ? (
        <script
          type="application/ld+json"
          // Escapowanie „<" chroni przed wyjściem z tagu <script> dla danych z bazy.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}

      <Link
        href={BASE_PATH}
        className={cn(TEXT_LINK, 'font-semibold')}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('backToResults')}
      </Link>

      {job.isDemo ? <DemoJobsNotice className="mt-6" /> : null}
      {/* Lejek ofert (#99): zliczenie po załadowaniu, bez wpływu na cache ISR tej strony. */}
      {job.isDemo ? null : <JobFunnelBeacon event="detail_view" jobIds={[job.id]} />}

      {/* `.offer-layout` (#7, Z2): treść + panel 300 px, odstęp 36 px; jedna kolumna < 1024 px. */}
      <div className="mt-[30px] grid min-w-0 gap-9 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Treść */}
        <div className="min-w-0">
          {/* Paszport oferty: nagłówek i stała metryka z rzeczywistych danych. */}
          {/* Nagłówek `.extended` (nadtytuł „kategoria / miasto”, H1 40/30 px, `.dash-intro` z firmą)
              i karta-paszport `.job-passport` ze stałą metryką z rzeczywistych danych. */}
          <header data-testid="job-detail-passport" className="min-w-0">
            <p className={EYEBROW}>
              {tCategory(job.category)} / {job.city}
            </p>
            <h1 lang={contentLang} className={H1_EXTENDED}>
              {job.title}
            </h1>
            <p className={cn(INTRO, 'mt-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1')}>
              <span className="break-words">{job.companyName}</span>
              {job.companyVerified && !job.isDemo ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text">
                  <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('verified')}
                </span>
              ) : null}
            </p>

            <div className="mt-6 min-w-0 rounded-[24px] border border-[color:var(--pp-line-card)] bg-card px-[26px] pb-5 pt-[22px] max-[500px]:rounded-[20px] max-[500px]:p-[18px]">
            <dl
              className={cn(
                'grid min-w-0 border-y border-[color:var(--pp-line-data)]',
                passportFields.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3',
              )}
            >
              {passportFields.map((field, index) => (
                <div
                  key={field.key}
                  data-passport-field={field.key}
                  className={cn(
                    'min-w-0 py-5',
                    index === 0
                      ? 'sm:pr-5'
                      : 'border-t border-[color:var(--pp-line-data)] sm:border-l sm:border-t-0 sm:pl-5',
                    index > 0 && index < passportFields.length - 1 ? 'sm:pr-5' : undefined,
                  )}
                >
                  <dt className="mb-3 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    {field.label}
                  </dt>
                  <dd className="break-words text-base font-semibold text-foreground">
                    {field.primary}
                    {field.secondary ? (
                      <span className="mt-1 block text-sm font-normal text-muted-foreground">
                        {field.secondary}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 inline-flex max-w-full items-start gap-2 text-sm text-muted-foreground">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{t('publishedOn')} {publishedLabel}</span>
            </p>

            {contentLang ? (
              <p data-testid="job-content-language" className="mt-3 inline-flex max-w-full items-start gap-2 text-sm text-muted-foreground">
                <LanguagesIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="break-words">
                  {t('contentLanguageNotice', { language: t(`contentLanguageNames.${contentLang}`) })}
                </span>
              </p>
            ) : null}
            </div>
          </header>

          {/*
            Kotwice do sekcji (nawigacja w obrębie strony, nie zakładki ARIA). Bez stałego
            `aria-current`/wyróżnienia pierwszej pozycji — strona nie śledzi bieżącej sekcji.
          */}
          <nav aria-label={t('sectionsNav')} className="mt-[25px] border-b border-[color:var(--pp-line)]">
            <ul className="-mb-px flex flex-wrap gap-6">
              {tabs.map((tab) => (
                <li key={tab.href}>
                  <a
                    href={tab.href}
                    className="inline-block border-b-2 border-transparent pb-3 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
                  >
                    {tab.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Treść oferty w jednej karcie `.paper` (h2 23 px, h3 18 px, akapity 15 px / 1,7). */}
          <div className={cn(PAPER, 'mt-[25px] lg:space-y-8')}>
            <Section id="opis" title={t('aboutRole')}>
              <p lang={contentLang} className={cn(P_EXTENDED, 'whitespace-pre-line')}>{job.description}</p>
            </Section>

            {job.responsibilities.length > 0 ? (
              <Section title={t('responsibilities')}>
                <ul lang={contentLang} className="space-y-2">
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
                <ul lang={contentLang} className="space-y-2">
                  {job.requirementsMandatory.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                      <span className="text-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
                {job.requirementsOptional.length > 0 ? (
                  <>
                    <h3 className={cn(H3_EXTENDED, 'mb-2')}>
                      {t('requirementsOptional')}
                    </h3>
                    <ul lang={contentLang} className="space-y-2">
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
                <ul lang={contentLang} className="grid gap-3 sm:grid-cols-2">
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
              {/*
                Każda para dt/dd jest bezpośrednio w `div` będącym dzieckiem `dl` (HTML/axe
                `definition-list`); ikona jest dekoracją wewnątrz `dt`, pozycjonowaną w lewym odstępie.
              */}
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="relative pl-[1.875rem]">
                  <dt className="text-sm text-muted-foreground">
                    <Home
                      className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {t('accommodation')}
                  </dt>
                  <dd className="font-medium text-foreground">
                    {job.accommodation ? tCommon('yes') : tCommon('no')}
                  </dd>
                </div>
                <div className="relative pl-[1.875rem]">
                  <dt className="text-sm text-muted-foreground">
                    <Truck
                      className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {t('transport')}
                  </dt>
                  <dd className="font-medium text-foreground">
                    {job.transport ? tCommon('yes') : tCommon('no')}
                  </dd>
                </div>
                {job.languages.length > 0 ? (
                  <div className="relative pl-[1.875rem]">
                    <dt className="text-sm text-muted-foreground">
                      <LanguagesIcon
                        className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {t('languages')}
                    </dt>
                    <dd className="font-medium text-foreground">{job.languages.join(', ')}</dd>
                  </div>
                ) : null}
              </dl>
            </Section>
          </div>

          {/* Informacje o firmie */}
          <div className={cn(PAPER, 'mt-[25px]')}>
          <Section id="firma" title={t('aboutCompany')}>
            <div>
              <div className="flex items-center gap-3">
                {companyLogo}
                <div>
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    {job.companyName}
                    {job.companyVerified && !job.isDemo ? (
                      <BadgeCheck className="h-4 w-4 text-success" aria-hidden="true" />
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('industry')}: {tCategory(job.category)}
                  </p>
                </div>
              </div>
              <p lang={contentLang} className={cn(P_EXTENDED, 'mt-3')}>{job.companyDescription}</p>
              <Link
                href={`${BASE_PATH}?keyword=${encodeURIComponent(job.companyName)}`}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-dark"
              >
                {t('learnMoreCompany')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              {/* Blokada firmy (tylko zalogowany kandydat; wyspa kliencka, #97). Demo — brak. */}
              {job.isDemo ? null : <JobCompanyBlockControl jobId={job.id} />}
            </div>
          </Section>
          </div>

          {/* Zgłoszenie treści (DSA, #41) — także bez konta. Oferta przykładowa nie jest treścią serwisu. */}
          {job.isDemo ? null : (
            <nav aria-label={tReport('reportNavLabel')} className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
              <p>{tReport('reportPrompt')}</p>
              <ul className="mt-1 flex flex-wrap gap-x-4">
                <li>
                  <Link
                    href={`/zglos-tresc?oferta=${encodeURIComponent(job.slug)}`}
                    className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    {tReport('reportJob')}
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/zglos-tresc?oferta=${encodeURIComponent(job.slug)}&cel=firma`}
                    className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    {tReport('reportCompany')}
                  </Link>
                </li>
              </ul>
            </nav>
          )}
        </div>

        {/* Panel boczny */}
        <aside className="min-w-0">
          <div className="space-y-5 lg:sticky lg:top-24">
            {/* Dopasowanie do profilu (tylko dla zalogowanego kandydata; wyspa kliencka) */}
            <div data-testid="job-match-slot">
              <JobMatchCard jobId={job.id} />
            </div>

            {/* Aplikuj (desktop — mobile ma dolny pasek) */}
            {/* `.paper.apply-box` — „Twój następny krok”: Aplikuj (`.btn`) i Zapisz (`.btn.secondary`). */}
            <section className={cn(PAPER, 'my-0 hidden lg:block')}>
              <p className={EYEBROW}>{t('applyBoxEyebrow')}</p>
              <h2 className={cn(H2_EXTENDED, 'mt-2')}>{t('applyBoxTitle')}</h2>
              <p className={cn(P_EXTENDED, 'mt-2')}>
                {t('applyBoxText')} {applyHint}
              </p>
              <ApplyModal
                jobId={job.id}
                companyName={job.companyName}
                demo={job.isDemo}
                screeningQuestions={job.screeningQuestions}
                contentLocale={job.contentLocale}
                triggerLabel={applyLabel}
                triggerSize="passport"
                triggerClassName="mt-3 w-full"
              />
              <PublicSaveJobButton jobId={job.id} passport className="mt-3 w-full" />
            </section>

            {/* Kontakt */}
            <div className={cn(PAPER, 'my-0')}>
              <h2 className="mb-3 text-base font-semibold text-foreground">{t('contactTitle')}</h2>
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">{job.companyName}</p>
                  <p className="text-sm text-muted-foreground">{t('contactViaPlatform')}</p>
                </div>
              </div>
              {job.languages.length > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('languages')}: {job.languages.join(', ')}
                </p>
              ) : null}
              {/* Do fikcyjnej firmy demo nie da się napisać (#297). */}
              {job.isDemo ? null : (
                <Link
                  href={loginHref(`/${locale}${BASE_PATH}/${slug}`)}
                  className={cn(buttonVariants({ variant: 'outline' }), 'mt-4 h-auto min-h-12 w-full whitespace-normal text-center')}
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  {t('sendMessage')}
                </Link>
              )}
            </div>

            {/* Podobne oferty */}
            {similar.status === 'error' ? (
              <div id="podobne" className={cn(PAPER, 'my-0')}>
                <h2 className="mb-3 text-base font-semibold text-foreground">{t('similarJobs')}</h2>
                <SimilarJobsError message={t('similarJobsLoadError')} retry={tCommon('retry')} />
              </div>
            ) : similarJobs.length > 0 ? (
              <div id="podobne" className={cn(PAPER, 'my-0')}>
                <h2 className="mb-3 text-base font-semibold text-foreground">{t('similarJobs')}</h2>
                <ul className="divide-y divide-border">
                  {similarJobs.map((item) => {
                    const itemSalary = formatSalaryRange(item, locale, {
                      from: value => tJobs('passport.salaryFrom', { value }),
                      to: value => tJobs('passport.salaryTo', { value }),
                      period: period => tJobs(`passport.salaryPeriods.${period}`),
                    });
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
                            <p className="break-words text-sm font-medium text-foreground group-hover:text-accent">
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

      {/*
        Dolny pasek (mobile): jeden wiersz — zapis jako ikona 48×48 (opis stanu w nazwie
        dostępnej), CTA zajmuje resztę szerokości. Pasek sam rezerwuje miejsce pod całą
        stroną (padding body, także pod stopką) i margines przewijania, aby element z fokusem
        nie chował się pod nim (WCAG 2.4.11). Jednostki rem skalują się z powiększeniem tekstu.
      */}
      <div
        data-testid="job-mobile-cta-bar"
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-background/95 p-3 shadow-[0_-4px_12px_hsl(var(--foreground)/0.08)] backdrop-blur lg:hidden max-lg:[body:has(&)]:pb-24 max-lg:[html:has(&)]:scroll-pb-28"
      >
        <PublicSaveJobButton jobId={job.id} iconOnly />
        <ApplyModal
          jobId={job.id}
          companyName={job.companyName}
          demo={job.isDemo}
          screeningQuestions={job.screeningQuestions}
          contentLocale={job.contentLocale}
          triggerLabel={applyLabel}
          triggerSize="passport"
          triggerClassName="min-w-0 flex-1"
        />
      </div>
    </div>
    </PublicSavedJobsProvider>
  );
}
