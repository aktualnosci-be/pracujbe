import { cache } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { BadgeCheck, ExternalLink, SearchX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Breadcrumbs } from '@/components/public/Breadcrumbs';
import { JobCard } from '@/components/public/JobCard';
import { FollowCompanyButton } from '@/components/candidate/FollowCompanyButton';
import { Pagination } from '@/components/public/Pagination';
import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { openGraphLocales } from '@/lib/seo/locales';
import {
  brandShareImageUrl,
  buildBreadcrumbListJsonLd,
  buildOrganizationJsonLd,
  serializeJsonLd,
} from '@/lib/seo/structured-data';
import { companyProfilePath, getCompanyProfile, type CompanyProfile } from '@/lib/companies';
import { isPublicHttpsUrl, sameOriginHost } from '@/lib/company-links';

/**
 * Wspólny widok i metadane profilu publicznego firmy (#591) dla strony 1
 * (`/pracodawcy/<slug>`) i kolejnych stron ofert (`/pracodawcy/<slug>/strona/<n>`, #638).
 *
 * Każda strona ma własny adres kanoniczny i hreflang tej samej strony w innych językach —
 * kolejne strony nie są duplikatami, tylko następnymi wycinkami listy ofert. Strona za końcem
 * albo firma bez profilu = 404 (`getCompanyProfile` zwraca `null`, Invariant #8).
 */

const JOBS_PATH = '/oferty-pracy';

/**
 * Jeden odczyt profilu na żądanie (#1096): metadane i widok dzielą wynik przez `cache()`
 * Reacta (zakres jednego renderu serwera), zamiast dwóch zapytań do bazy.
 */
const loadCompanyProfile = cache(getCompanyProfile);

/** Jak w szczególe oferty (`oferty-pracy/[slug]/page.tsx`): jedna linia, granica słowa, wielokropek. */
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

/** Host własnej witryny — jedyny, z którego CSP (`img-src 'self'`) pozwala wyświetlić logo. */
function ownSiteHost(): string {
  try {
    return new URL(env.siteUrl).host;
  } catch {
    return '';
  }
}

/**
 * Logo firmy do wyświetlenia (#686) albo `null` (inicjały). Adres jest już zweryfikowany
 * w bazie (`public_https_url`, zatwierdzony przez admina — 0156), ale sprawdzamy go drugi raz,
 * a obraz pokazujemy wyłącznie z hosta własnej witryny: CSP (`img-src`) i `images.remotePatterns`
 * nie dopuszczają obcych hostów, a pobieranie obrazka z serwera firmy zdradzałoby jej serwerowi
 * adres odwiedzającego przed jakąkolwiek zgodą (Invariant #7). Logo spoza witryny = inicjały.
 */
export function profileLogoSrc(logoUrl: string | undefined, ownHost: string = ownSiteHost()): string | null {
  if (!logoUrl || !isPublicHttpsUrl(logoUrl)) return null;
  return sameOriginHost(logoUrl, ownHost) ? logoUrl : null;
}

/** Strona WWW firmy (#686): tylko bezwzględny https (drugie sprawdzenie po `public_https_url`). */
export function profileWebsite(website: string | undefined): { href: string; label: string } | null {
  if (!website || !isPublicHttpsUrl(website)) return null;
  try {
    const url = new URL(website);
    const path = url.pathname === '/' ? '' : url.pathname;
    return { href: url.href, label: `${url.host.replace(/^www\./, '')}${path}` };
  } catch {
    return null;
  }
}

/**
 * Stan języka opisu wobec języka strony (#708): `match` = opis w języku strony, `other` = firma
 * wskazała inny język, `unknown` = nie wskazała (albo zmieniła opis po wskazaniu), `none` = brak opisu.
 */
export function descriptionLanguageState(
  company: Pick<CompanyProfile, 'description' | 'descriptionLocale'>,
  locale: string,
): 'match' | 'other' | 'unknown' | 'none' {
  if (!company.description.trim()) return 'none';
  if (!company.descriptionLocale) return 'unknown';
  return company.descriptionLocale === locale ? 'match' : 'other';
}

export async function companyProfileMetadata(locale: string, slug: string, page: number): Promise<Metadata> {
  const result = await loadCompanyProfile(slug, locale, page);
  if (!result) {
    return { robots: { index: false, follow: false } };
  }

  const t = await getTranslations({ locale, namespace: 'companyProfile' });
  const base = env.siteUrl;
  const path = companyProfilePath(slug, result.page);
  const url = `${base}/${locale}${path}`;
  const title =
    result.page > 1
      ? t('metaTitlePage', { name: result.company.name, page: result.page })
      : t('metaTitle', { name: result.company.name });
  // #647: opis firmy różnicuje profile w wynikach wyszukiwania i podglądach linków — bez niego
  // wszystkie profile miały identyczny opis z podmienioną tylko nazwą. Fallback zostaje dla
  // firmy bez opisu (Invariant #8: nic technicznego, sam tłumaczony tekst ogólny).
  // #708: opis zadeklarowany w INNYM języku niż strona nie trafia do metadanych tej wersji
  // językowej (wynik wyszukiwania i podgląd linku byłyby w innym języku niż strona) — wtedy
  // ogólny tekst w języku strony. Opis bez wskazanego języka zostaje (#647: nie wiemy, że jest obcy).
  const rawDescription = result.company.description.trim();
  const descriptionState = descriptionLanguageState(result.company, locale);
  const description = rawDescription && descriptionState !== 'other'
    ? truncate(rawDescription, 160)
    : t('metaDescription', { name: result.company.name });
  const shareImage = brandShareImageUrl(base);
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  // Profil bez aktywnych ofert nie wnosi treści dla kandydata (sama nazwa i opis): `noindex,
  // follow` i bez canonical/hreflang — jak pusty landing (#299). Sitemap i tak go pomija (profile
  // zbierane z ofert). Wraca do indeksu przy pierwszej aktywnej ofercie (ISR, revalidate 60 s).
  const indexable = result.company.activeJobsCount > 0;

  return {
    title: { absolute: title },
    description,
    ...(indexable
      ? { alternates: { canonical: url, languages } }
      : { robots: { index: false, follow: true } }),
    openGraph: {
      title,
      description,
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      ...openGraphLocales(locale),
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [shareImage] },
  };
}

export async function CompanyProfileView({
  locale,
  slug,
  page,
}: {
  locale: string;
  slug: string;
  page: number;
}): Promise<React.JSX.Element> {
  const result = await loadCompanyProfile(slug, locale, page);
  if (!result) {
    notFound();
  }
  const { company, jobs, lastPage, pageSize } = result;

  const profileUrl = `${env.siteUrl}/${locale}${companyProfilePath(slug)}`;
  const organizationJsonLd = buildOrganizationJsonLd(
    {
      name: company.name,
      description: company.description,
      city: company.city,
      region: company.region,
      website: company.website,
      logoUrl: company.logoUrl,
    },
    profileUrl,
  );

  const [t, tJob, tJobs, tCommon, tLang] = await Promise.all([
    getTranslations('companyProfile'),
    getTranslations('job'),
    getTranslations('jobs'),
    getTranslations('common'),
    getTranslations('languageNames'),
  ]);
  const logoSrc = profileLogoSrc(company.logoUrl);
  const website = profileWebsite(company.website);
  const descriptionState = descriptionLanguageState(company, locale);
  const pageStatus = t('pageStatus', { page: result.page, lastPage });

  // Widoczna ścieżka i BreadcrumbList z jednej listy — dane strukturalne = nawigacja (#930).
  const trail = [
    { label: tCommon('home'), href: '/' },
    { label: tJobs('pageTitle'), href: JOBS_PATH },
    ...(result.page > 1
      ? [{ label: company.name, href: companyProfilePath(slug) }, { label: pageStatus }]
      : [{ label: company.name }]),
  ];
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(trail, {
    base: env.siteUrl,
    locale,
    currentUrl: `${env.siteUrl}/${locale}${companyProfilePath(slug, result.page)}`,
  });

  return (
    <PublicSavedJobsProvider key={JSON.stringify(jobs.map((job) => job.id))} jobIds={jobs.map((job) => job.id)}>
      {/* Organization (#591): strona istnieje tylko dla firmy zweryfikowanej. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <div className="container py-6 md:py-10">
        <Breadcrumbs
          ariaLabel={tCommon('breadcrumb')}
          items={trail}
        />

        <header className="mt-4 flex items-start gap-4">
          {logoSrc ? (
            // #686: logo zatwierdzone przez admina (0156), tylko z hosta witryny (CSP).
            <Image
              src={logoSrc}
              alt={t('logoAlt', { name: company.name })}
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 shrink-0 rounded-md bg-background object-contain ring-1 ring-inset ring-border"
              data-testid="company-logo"
            />
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-soft text-lg font-semibold text-muted-foreground ring-1 ring-inset ring-border"
              aria-hidden="true"
            >
              {initials(company.name)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="pp-page-title flex flex-wrap items-center gap-2">
              {company.name}
              <BadgeCheck className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              <span className="sr-only">{tJob('verified')}</span>
            </h1>
            {company.city || company.industry ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {[company.industry, [company.city, company.region].filter(Boolean).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            {website ? (
              // #686: strona WWW zatwierdzona przez admina (0156). Link zewnętrzny: nowa karta
              // (zapowiedziana czytnikowi), bez przekazania adresu strony i bez wartości SEO.
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">{t('websiteLabel')}: </span>
                <a
                  href={website.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-h-11 items-center gap-1 break-all font-medium text-accent underline underline-offset-4"
                  data-testid="company-website"
                >
                  {website.label}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only"> {t('opensInNewTab')}</span>
                </a>
              </p>
            ) : null}
          </div>
        </header>

        {descriptionState === 'none' ? (
          <p className="mt-4 max-w-2xl text-muted-foreground">{t('noDescription')}</p>
        ) : (
          <div className="mt-4 max-w-2xl">
            {/* #708: opis w języku wskazanym przez firmę — `lang` dla czytnika i wyszukiwarki. */}
            <p
              className="whitespace-pre-line text-muted-foreground"
              {...(company.descriptionLocale ? { lang: company.descriptionLocale } : {})}
              data-testid="company-description"
            >
              {company.description}
            </p>
            {descriptionState === 'other' && company.descriptionLocale ? (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="company-description-language">
                {t('descriptionLanguageOther', { language: tLang(company.descriptionLocale) })}
              </p>
            ) : descriptionState === 'unknown' ? (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="company-description-language">
                {t('descriptionLanguageUnknown')}
              </p>
            ) : null}
          </div>
        )}

        {/* #855: obserwowanie firmy — wyspa klienta (strona zostaje ISR, stan z sesji po załadowaniu). */}
        <FollowCompanyButton
          companyId={company.id}
          companySlug={company.slug}
          labels={{
            follow: t('follow'),
            following: t('following'),
            followed: t('followed'),
            unfollowed: t('unfollowed'),
            login: t('followLogin'),
            stateError: t('followStateError'),
            networkError: t('followNetworkError'),
          }}
        />

        <section className="mt-8" aria-labelledby="company-jobs-heading">
          <h2 id="company-jobs-heading" className="text-lg font-semibold text-foreground">
            {t('jobsHeading')}
          </h2>
          {jobs.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-soft px-6 py-16 text-center">
              <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-md text-muted-foreground">{t('empty')}</p>
              <Link
                href={JOBS_PATH}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                {t('backToJobs')}
              </Link>
            </div>
          ) : (
            <>
              {/* Liczba wszystkich ofert (#638): strona 1 nie udaje całej oferty firmy. */}
              <p className="mt-1 text-sm text-muted-foreground" data-testid="company-jobs-count">
                {t('jobsCount', { count: company.activeJobsCount })}
                {lastPage > 1 ? ` · ${pageStatus}` : null}
              </p>
              <ul className="pp-job-grid mt-4">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
              <Pagination
                basePath={companyProfilePath(slug)}
                page={result.page}
                total={company.activeJobsCount}
                pageSize={pageSize}
                maxPage={lastPage}
                pathForPage={(target) => companyProfilePath(slug, target)}
              />
            </>
          )}
        </section>
      </div>
    </PublicSavedJobsProvider>
  );
}
