import { cache } from 'react';
import { openGraphLocales } from '@/lib/seo/locales';
import { languageDisplayName } from '@/lib/languages';
import { formatSalaryRange } from '@/lib/salary';
import { PublicSavedJobsProvider, PublicSaveJobButton } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Home,
  Clock,
  Languages as LanguagesIcon,
  MapPin,
  MessageSquare,
  Scale,
  Truck,
  Utensils,
  Wrench,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import { HELP_VERIFICATION_HREF } from '@/lib/help-anchors';
import { buildJobDetailPassportFields } from '@/lib/job-detail-passport';
import type { JobQualificationItem } from '@/lib/job-qualifications';
import {
  buildJobBenefitsText,
  buildJobCostItems,
  formatEuro,
  hasJobCostDetails,
  type JobCostItem,
  type JobCostLabels,
} from '@/lib/job-costs';
import { minimumWagesUrl } from '@/lib/joint-committees';
import { defaultAlternateLocale } from '@/lib/job-content-locale';
import { jobStartDateInstant, jobStartInfo } from '@/lib/job-start';
import { getJobBySlug, getSimilarJobs, type JobDetail } from '@/lib/jobs';
import type { TranslatableScalar } from '@/lib/job-machine-translation';
import { getCandidateMinAge } from '@/lib/data/age-policy';
import {
  brandShareImageUrl,
  buildBreadcrumbListJsonLd,
  buildJobPostingJsonLd,
  serializeJsonLd,
} from '@/lib/seo/structured-data';
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
import { EmployerApplyChannel } from '@/components/public/EmployerApplyChannel';
import { JobExplainPanelLazy as JobExplainPanel } from '@/components/public/JobExplainPanelLazy';
import { jobExplainProvider } from '@/lib/ai-explain/config';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { JobFunnelBeacon } from '@/components/public/JobFunnelBeacon';
import { loginHref } from '@/lib/auth/next-path';
// #1130: osobny chunk — karta dopasowania tylko w trybie RECRUITMENT (budżet JS #395).
import { JobMatchCardLazy as JobMatchCard } from '@/components/public/JobMatchCardLazy';
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
 * Tryb ogłoszeniowy (#1130, decyzja produktowa: portal ogłoszeniowy): zamiast `ApplyModal`
 * przycisk „Aplikuj u pracodawcy” prowadzi do kanału ogłoszeniodawcy (`job.applyChannel`:
 * strona https w nowej karcie, `mailto:` albo `tel:`), bez „Wyślij wiadomość”. Oferta bez kanału
 * = brak przycisku i neutralny komunikat. Tryb `RECRUITMENT` — dotychczasowy `ApplyModal`.
 *
 * Uwaga na Invariant #8: nie fabrykujemy danych osobowych kontaktu ani ocen — kontakt jest
 * generyczny (przez platformę), a aplikowanie/zapis wymagają konta (logowanie).
 *
 * TODO(i18n-slugs): jeden segment `oferty-pracy` dla wszystkich języków; lokalizowane slugi
 * w mapie drogowej (spec 12).
 *
 * „Dowiedz się więcej o firmie” (#591) prowadzi do dedykowanego, stabilnego profilu firmy
 * `/pracodawcy/<slug>` (`job.companySlug`, tylko firma verified — 0140); bez sluga (nie powinno
 * się zdarzyć dla zweryfikowanej firmy, ale bezpiecznik) CTA jest ukryte zamiast linkować do
 * wyszukiwarki po nazwie, która mogła zwrócić oferty innej firmy albo nic.
 */

const BASE_PATH = '/oferty-pracy';
/** Hub i landing branży — pośrednie pozycje BreadcrumbList (jak ścieżka landingu kategorii). */
const HUB_PATH = '/praca';
const CATEGORY_BASE = '/praca/kategoria';

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

/**
 * Jeden odczyt oferty na żądanie (#1096): `generateMetadata` i strona dzielą wynik przez
 * `cache()` Reacta (zakres jednego renderu serwera), zamiast dwóch zapytań do bazy.
 */
const loadJobBySlug = cache(getJobBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const job = await loadJobBySlug(slug, locale);
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
      ...openGraphLocales(version.canonicalLocale, version.alternates),
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

/** Ikony pozycji „Koszty i dodatki” (dekoracja, `aria-hidden`). */
const COST_ICONS: Record<JobCostItem['key'], typeof Home> = {
  accommodation: Home,
  transport: Truck,
  mealVouchers: Utensils,
  jointCommittee: Scale,
};

export default async function JobDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const job = await loadJobBySlug(slug, locale);
  if (!job) {
    notFound();
  }
  const messagingOn = isRecruitmentEnabled('messaging');
  const explainProvider = jobExplainProvider();

  const [t, tJobs, tContract, tCategory, tCommon, tApply, tReport, tLanding, tLang, tBenefits, format, candidateMinAge] = await Promise.all([
    getTranslations('job'),
    getTranslations('jobs'),
    getTranslations('contractTypes'),
    getTranslations('categories'),
    getTranslations('common'),
    getTranslations('apply'),
    getTranslations('contentReport'),
    getTranslations('landing'),
    getTranslations('languageNames'),
    getTranslations('jobBenefits'),
    getFormatter(),
    // #492: próg deklaracji wieku w formularzu gościa (dane z bazy, odczyt bez cookies — ISR).
    job.isDemo ? Promise.resolve(undefined) : getCandidateMinAge(),
  ]);
  // 0227 (#858): grafik pracy w języku widza (te same etykiety co filtr listy).
  const shiftPatternLabels = job.shiftPatterns?.length
    ? await getTranslations('filters.shiftPatternValues').then((tShift) =>
        job.shiftPatterns!.map((pattern) => tShift(pattern)).join(', '),
      )
    : null;
  // I18N-02: wymagane języki w języku widza (kod słownika 0168 / nazwa PL-NL-FR-EN), a nie
  // etykieta w języku pracodawcy; stary wpis spoza słownika bez zmian.
  const languageNames = job.languages.map((l) => languageDisplayName(l, (code) => tLang(code))).join(', ');

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
  // #1112: „Praca od zaraz” i data rozpoczęcia z kreatora (dzień kalendarzowy — strefa UTC).
  const start = jobStartInfo(job);
  const startDateLabel = start.date
    ? format.dateTime(jobStartDateInstant(start.date), { dateStyle: 'long', timeZone: 'UTC' })
    : null;

  // 0169: „Koszty i dodatki” — sekcja strony i `jobBenefits` w JSON-LD z jednego źródła.
  const pageLocale: Locale = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
  const costLabels: JobCostLabels = {
    accommodation: t('accommodation'),
    transport: t('transport'),
    mealVouchers: t('mealVouchers'),
    jointCommittee: t('jointCommittee'),
    yes: tCommon('yes'),
    no: tCommon('no'),
    kind: (kind) => t(`costs.kind.${kind}`),
    cost: (amount, period) => t('costs.cost', { amount, period }),
    free: t('costs.free'),
    deducted: (yes) => t(yes ? 'costs.deductedYes' : 'costs.deductedNo'),
    registration: (yes) => t(yes ? 'costs.registrationYes' : 'costs.registrationNo'),
    afterContract: (value) => t(`costs.afterContract.${value}`),
    shuttle: t('costs.shuttle'),
    reimbursed: t('costs.reimbursed'),
    mealPerDay: (amount) => t('costs.mealPerDay', { amount }),
    committeeCode: (code) => t('costs.committeeCode', { code }),
    money: (amount) => formatEuro(amount, pageLocale),
  };
  const costItems = buildJobCostItems(job, costLabels, pageLocale);
  const hasCostDetails = hasJobCostDetails(job.costs);

  const url = `${env.siteUrl}/${locale}${BASE_PATH}/${slug}`;
  const version = contentLanguage(job, locale);
  // JobPosting tylko na wersji kanonicznej — wersja bez tłumaczenia nie powiela danych (#301).
  // Fikcyjna oferta demo nie udaje ogłoszenia o pracę w danych strukturalnych (#297).
  // #1130: tryb czytany przy renderze (ISR na serwerze), nie w przeglądarce — patrz portal-mode.ts.
  const recruitment = isRecruitmentEnabled('applications');
  const jsonLd = version.fallback || job.isDemo
    ? null
    : buildJobPostingJsonLd(job, url, {
        responsibilities: t('responsibilities'),
        requirementsMandatory: t('requirementsMandatory'),
        requirementsOptional: t('requirementsOptional'),
        conditions: t('conditions'),
        workingHours: t('workingHours'),
        shifts: t('shifts'),
      }, { jobBenefits: buildJobBenefitsText(job, costLabels, pageLocale), directApply: recruitment });
  // BreadcrumbList (SEO): Strona główna → Praca → branża (landing `/praca/kategoria/<klucz>`,
  // jak ścieżka tego landingu) → oferta. Tylko tam, gdzie JobPosting — wersja bez tłumaczenia
  // kanonizuje się do innego języka (#301), a oferta demo jest noindex (#297).
  const breadcrumbJsonLd = jsonLd
    ? buildBreadcrumbListJsonLd(
        [
          { label: tCommon('home'), href: '/' },
          { label: tLanding('breadcrumbHub'), href: HUB_PATH },
          { label: tCategory(job.category), href: `${CATEGORY_BASE}/${job.category}` },
          { label: job.title },
        ],
        { base: env.siteUrl, locale, currentUrl: url },
      )
    : null;
  // Treść w innym języku niż strona → `lang` na fragmentach treści (WCAG 3.1.2).
  // Przekład (#33) jest w języku strony — bez `lang`, za to z oznaczeniem i linkiem do oryginału.
  // SEO bez zmian: wersja z przekładem nadal kanonizuje się do oryginału i nie ma JobPosting.
  const translation = job.machineTranslation;
  const contentLang = version.fallback && !translation ? version.contentLocale : undefined;
  // „Inne benefity” to tekst pracodawcy bez przekładu (#826): przy przekładzie strony zostaje
  // w języku źródła, więc `lang` = język źródła, gdy różni się od strony.
  const benefitsOtherLang = translation
    ? translation.sourceLocale !== locale
      ? translation.sourceLocale
      : undefined
    : contentLang;

  // #896: przy częściowym przekładzie pole bez klucza w przekładzie zostaje w oryginale —
  // oznaczamy je językiem źródła, a nie językiem dokumentu (WCAG 3.1.2).
  const fieldLang = (field: TranslatableScalar): string | undefined =>
    translation
      ? (translation.untranslated?.includes(field) ? translation.sourceLocale : undefined)
      : contentLang;

  // #866: wpis pracodawcy (umiejętność spoza słownika, certyfikat) jest w języku treści oferty —
  // także przy przekładzie (#33), który kwalifikacji nie tłumaczy; nazwa ze słownika = język strony.
  const qualificationLang = job.contentLocale && job.contentLocale !== pageLocale ? job.contentLocale : undefined;
  const qualifications = job.qualifications;
  const qualificationGroups = qualifications
    ? ([
        { key: 'skillsMandatory', label: t('qualifications.skillsMandatory'), icon: Wrench, items: qualifications.skillsMandatory },
        { key: 'skillsOptional', label: t('qualifications.skillsOptional'), icon: Wrench, items: qualifications.skillsOptional },
        { key: 'certificates', label: t('qualifications.certificates'), icon: Award, items: qualifications.certificates },
      ] satisfies { key: string; label: string; icon: typeof Wrench; items: JobQualificationItem[] }[]).filter(
        (group) => group.items.length > 0,
      )
    : [];

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
      {breadcrumbJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
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
      {job.isDemo ? null : <JobFunnelBeacon event="detail_view" jobIds={[job.id]} applyClicks={!recruitment} />}

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
              {job.companySlug ? (
                <Link
                  href={`/pracodawcy/${job.companySlug}`}
                  className="break-words underline-offset-2 hover:underline"
                >
                  {job.companyName}
                </Link>
              ) : (
                <span className="break-words">{job.companyName}</span>
              )}
              {job.companyVerified && !job.isDemo ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
                  <span className="inline-flex items-center gap-1 text-success-text" data-testid="job-detail-verified">
                    <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('verified')}
                  </span>
                  {/* #1151: odznaka = zweryfikowane dane rejestrowe firmy; wyjaśnienie w Pomocy. */}
                  <Link
                    href={HELP_VERIFICATION_HREF}
                    className="rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {t('verifiedHelp')}
                  </Link>
                </span>
              ) : null}
              {job.isAgency ? (
                // 0167: oferta agencji pracy tymczasowej (deklaracja firmy).
                <span
                  data-testid="job-detail-agency"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground"
                >
                  <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {tJobs('agencyBadge')}
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

            {start.immediate || startDateLabel ? (
              <p data-testid="job-start" className="mt-3 inline-flex max-w-full items-start gap-2 text-sm text-muted-foreground">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="break-words">
                  {[
                    start.immediate ? t('startImmediate') : null,
                    startDateLabel ? `${t('startDate')}: ${startDateLabel}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
            ) : null}

            {translation ? (
              <p data-testid="job-machine-translation" className="mt-3 inline-flex max-w-full items-start gap-2 text-sm text-muted-foreground">
                <LanguagesIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="break-words">
                  {translation.origin === 'ai'
                    ? t('machineTranslationNotice', { language: t(`contentLanguageNames.${translation.sourceLocale}`) })
                    : t('manualTranslationNotice', { language: t(`contentLanguageNames.${translation.sourceLocale}`) })}{' '}
                  <Link
                    href={`${BASE_PATH}/${slug}`}
                    locale={translation.sourceLocale}
                    hrefLang={translation.sourceLocale}
                    className={TEXT_LINK}
                  >
                    {t('translationOriginalLink')}
                  </Link>
                </span>
              </p>
            ) : null}

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
              <p lang={fieldLang('description')} className={cn(P_EXTENDED, 'whitespace-pre-line')}>{job.description}</p>
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

            {qualificationGroups.length > 0 ? (
              <Section title={t('qualifications.title')}>
                {/*
                  #866: kwalifikacje, po których kandydat znalazł ofertę (słowo kluczowe listy).
                  Układ `.info-pairs` prototypu jak „Koszty i dodatki”: para dt/dd w `div` dziecku `dl`.
                */}
                <dl className="grid gap-4 sm:grid-cols-2" data-testid="job-qualifications">
                  {qualificationGroups.map((group) => {
                    const Icon = group.icon;
                    return (
                      <div
                        key={group.key}
                        className={cn('relative pl-[1.875rem]', group.key === 'certificates' ? 'sm:col-span-2' : undefined)}
                        data-qualification-group={group.key}
                      >
                        <dt className="text-sm text-muted-foreground">
                          <Icon className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
                          {group.label}
                        </dt>
                        <dd className="mt-2">
                          <ul className="flex flex-wrap gap-2">
                            {group.items.map((item) => (
                              <li
                                key={item.label}
                                lang={item.localized ? undefined : qualificationLang}
                                className="max-w-full break-words rounded-full border border-[color:var(--pp-line)] bg-background px-3 py-1 text-sm font-medium text-foreground"
                              >
                                {item.label}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
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

            {/* #826 (0976): świadczenia — kody z katalogu w języku strony, „inne” w języku treści. */}
            {job.benefits && (job.benefits.codes.length > 0 || job.benefits.other.length > 0) ? (
              <Section title={t('benefitsTitle')}>
                <div data-testid="job-benefits">
                  {job.benefits.codes.length > 0 ? (
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {job.benefits.codes.map((code) => (
                        <li key={code} className="flex items-start gap-2.5" data-benefit={code}>
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                          <span className="text-foreground">{tBenefits(code)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {job.benefits.other.length > 0 ? (
                    <>
                      <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground">{t('benefitsOther')}</h3>
                      <ul lang={benefitsOtherLang} className="grid gap-3 sm:grid-cols-2">
                        {job.benefits.other.map((item) => (
                          <li key={item} className="flex items-start gap-2.5">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                            <span className="text-foreground">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </Section>
            ) : null}

            <Section title={t('costsTitle')}>
              {/*
                0169: „Koszty i dodatki” (deklaracja pracodawcy). Każda para dt/dd jest bezpośrednio
                w `div` będącym dzieckiem `dl` (HTML/axe `definition-list`); ikona jest dekoracją
                wewnątrz `dt`, pozycjonowaną w lewym odstępie.
              */}
              <dl className="grid gap-4 sm:grid-cols-2" data-testid="job-costs">
                {costItems.map((item) => {
                  const Icon = COST_ICONS[item.key];
                  return (
                    <div key={item.key} className="relative pl-[1.875rem]" data-cost-item={item.key}>
                      <dt className="text-sm text-muted-foreground">
                        <Icon
                          className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {item.label}
                      </dt>
                      <dd className="font-medium text-foreground">
                        {item.value}
                        {item.details.length > 0 ? (
                          <ul className="mt-1 space-y-0.5 text-sm font-normal text-muted-foreground">
                            {item.details.map((detail) => (
                              <li key={detail}>{detail}</li>
                            ))}
                          </ul>
                        ) : null}
                        {item.committeeCode ? (
                          <p className="mt-1 text-sm font-normal text-muted-foreground">
                            <a
                              href={minimumWagesUrl(pageLocale)}
                              className="font-medium text-foreground underline underline-offset-2"
                              rel="noreferrer"
                            >
                              {t('costs.minimumWagesLink')}
                            </a>
                            {' '}
                            {t('costs.minimumWagesNote')}
                          </p>
                        ) : null}
                      </dd>
                    </div>
                  );
                })}
                {job.workTime ? (
                  <div className="relative pl-[1.875rem]" data-testid="job-work-time">
                    <dt className="text-sm text-muted-foreground">
                      <Clock
                        className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {t('workTimeLabel')}
                    </dt>
                    <dd className="font-medium text-foreground">{t(`workTimeValues.${job.workTime}`)}</dd>
                  </div>
                ) : null}
                {shiftPatternLabels ? (
                  <div className="relative pl-[1.875rem]" data-testid="job-shift-patterns">
                    <dt className="text-sm text-muted-foreground">
                      <Clock
                        className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {t('shiftPatternsLabel')}
                    </dt>
                    <dd className="font-medium text-foreground">{shiftPatternLabels}</dd>
                  </div>
                ) : null}
                {job.languages.length > 0 ? (
                  <div className="relative pl-[1.875rem]">
                    <dt className="text-sm text-muted-foreground">
                      <LanguagesIcon
                        className="absolute left-0 top-0.5 h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {t('languages')}
                    </dt>
                    <dd className="font-medium text-foreground">{languageNames}</dd>
                  </div>
                ) : null}
              </dl>
              {hasCostDetails ? (
                <p className="mt-3 text-sm text-muted-foreground">{t('costsDeclared')}</p>
              ) : null}
            </Section>
          </div>

          {/*
            #773: „Wyjaśnij ofertę” — na żądanie, za flagą AI_JOB_EXPLAIN_ENABLED (domyślnie
            wyłączona). Osobna sekcja pod treścią oferty: treść nie jest zastępowana ani zmieniana.
            Oferta przykładowa tylko z atrapą (bez kosztów).
          */}
          {explainProvider && (!job.isDemo || explainProvider === 'fixture') ? (
            <JobExplainPanel slug={job.slug} locale={pageLocale} />
          ) : null}

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
              <p lang={fieldLang('companyDescription')} className={cn(P_EXTENDED, 'mt-3')}>{job.companyDescription}</p>
              {/* #591: CTA prowadzi do stabilnego profilu firmy; bez sluga (nie powinno się
                  zdarzyć dla zweryfikowanej firmy) — ukryte zamiast linkować donikąd. */}
              {job.companySlug ? (
                <Link
                  href={`/pracodawcy/${job.companySlug}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-dark"
                >
                  {t('learnMoreCompany')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : null}
              {/* Blokada firmy (tylko zalogowany kandydat; wyspa kliencka, #97). Demo — brak. */}
              {job.isDemo ? null : <JobCompanyBlockControl jobId={job.id} recruitmentEnabled={recruitment} />}
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
            {/* Dopasowanie do profilu (tylko dla zalogowanego kandydata; wyspa kliencka).
                #1131: w trybie ogłoszeniowym brak slotu — wyspa nie woła akcji dopasowania. */}
            {isRecruitmentEnabled('matching') ? (
              <div data-testid="job-match-slot">
                <JobMatchCard jobId={job.id} />
              </div>
            ) : null}

            {/* Aplikuj (desktop — mobile ma dolny pasek) */}
            {/* `.paper.apply-box` — „Twój następny krok”: Aplikuj (`.btn`) i Zapisz (`.btn.secondary`). */}
            {/* #1130: w trybie ogłoszeniowym ramka widoczna także na mobile — wymienia wszystkie
                kanały ogłoszeniodawcy (dolny pasek ma tylko przycisk główny). */}
            {recruitment ? (
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
                candidateMinAge={candidateMinAge}
                triggerLabel={applyLabel}
                triggerSize="passport"
                triggerClassName="mt-3 w-full"
              />
              <PublicSaveJobButton jobId={job.id} passport className="mt-3 w-full" />
            </section>
            ) : (
              <section className={cn(PAPER, 'my-0')} id="aplikuj" data-testid="employer-apply-box">
                <p className={EYEBROW}>{t('applyBoxEyebrow')}</p>
                <h2 className={cn(H2_EXTENDED, 'mt-2')}>{t('employerApply.boxTitle')}</h2>
                <p className={cn(P_EXTENDED, 'mt-2')}>{t('employerApply.boxText')}</p>
                <EmployerApplyChannel
                  jobId={job.id}
                  jobTitle={job.title}
                  channel={job.applyChannel}
                  demo={job.isDemo}
                  variant="box"
                  className="mt-3"
                />
                <PublicSaveJobButton jobId={job.id} passport className="mt-3 hidden w-full lg:flex" />
              </section>
            )}

            {/* Kontakt */}
            <div className={cn(PAPER, 'my-0')}>
              <h2 className="mb-3 text-base font-semibold text-foreground">{t('contactTitle')}</h2>
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">{job.companyName}</p>
                  {/* #1134: kontakt przez platformę tylko przy włączonych rozmowach. */}
                  <p className="text-sm text-muted-foreground">
                    {messagingOn ? t('contactViaPlatform') : t('employerApply.contact')}
                  </p>
                </div>
              </div>
              {job.languages.length > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('languages')}: {languageNames}
                </p>
              ) : null}
              {/* Do fikcyjnej firmy demo nie da się napisać (#297). #1134: w trybie ogłoszeniowym
                  (decyzja produktowa) portal nie prowadzi rozmów — bez „Wyślij wiadomość”. */}
              {!messagingOn || job.isDemo || !recruitment ? null : (
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
        {recruitment ? (
        <ApplyModal
          jobId={job.id}
          companyName={job.companyName}
          demo={job.isDemo}
          screeningQuestions={job.screeningQuestions}
          contentLocale={job.contentLocale}
          candidateMinAge={candidateMinAge}
          triggerLabel={applyLabel}
          triggerSize="passport"
          triggerClassName="min-w-0 flex-1"
        />
        ) : (
          <EmployerApplyChannel
            jobId={job.id}
            jobTitle={job.title}
            channel={job.applyChannel}
            demo={job.isDemo}
            variant="bar"
          />
        )}
      </div>
    </div>
    </PublicSavedJobsProvider>
  );
}
