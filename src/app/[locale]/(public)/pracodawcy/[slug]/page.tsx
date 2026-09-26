import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BadgeCheck, SearchX } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Breadcrumbs } from '@/components/public/Breadcrumbs';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { brandShareImageUrl, buildOrganizationJsonLd, serializeJsonLd } from '@/lib/seo/structured-data';
import { getCompanyProfile } from '@/lib/companies';
import { JobCard } from '@/components/public/JobCard';

/**
 * Profil publiczny firmy `/pracodawcy/<slug>` (#591, SSR/ISR, INDEKSOWALNY).
 *
 * Zastępuje dawne CTA „Dowiedz się więcej o firmie” na szczególe oferty, które prowadziło do
 * wyszukiwarki po nazwie firmy (`?keyword=<nazwa>` — dopasowanie tekstowe mogło zwrócić oferty
 * innej firmy albo nic). Adres jest stabilny: `companies.slug` jest ustawiany raz przy
 * zakładaniu firmy i NIE zmienia się przy zmianie wyświetlanej nazwy.
 *
 * Tylko zweryfikowana, nieusunięta firma ma profil — inna albo zły slug = 404 (Invariant #8,
 * `getCompanyProfile` nie ujawnia technikaliów). CTA na szczególe oferty (`job.companySlug`)
 * jest ukryte, gdy profil nie istnieje, zamiast linkować donikąd (patrz issue #591).
 */

const BASE_PATH = '/pracodawcy';
const JOBS_PATH = '/oferty-pracy';

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

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

/** ISR (#298): profil powstaje przy pierwszym żądaniu (build nie czyta bazy) i odświeża się co 60 s. */
export const revalidate = 60;

export function generateStaticParams(): Array<{ locale: string; slug: string }> {
  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await getCompanyProfile(slug, locale);
  if (!result) {
    return { robots: { index: false, follow: false } };
  }

  const t = await getTranslations({ locale, namespace: 'companyProfile' });
  const base = env.siteUrl;
  const path = `${BASE_PATH}/${slug}`;
  const url = `${base}/${locale}${path}`;
  const title = t('metaTitle', { name: result.company.name });
  const description = t('metaDescription', { name: result.company.name });
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
      locale,
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [shareImage] },
  };
}

export default async function CompanyProfilePage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const result = await getCompanyProfile(slug, locale);
  if (!result) {
    notFound();
  }
  const { company, jobs } = result;

  const profileUrl = `${env.siteUrl}/${locale}${BASE_PATH}/${slug}`;
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

  const [t, tJob, tJobs, tCommon] = await Promise.all([
    getTranslations('companyProfile'),
    getTranslations('job'),
    getTranslations('jobs'),
    getTranslations('common'),
  ]);

  return (
    <PublicSavedJobsProvider key={JSON.stringify(jobs.map((job) => job.id))} jobIds={jobs.map((job) => job.id)}>
      {/* Organization (#591): strona istnieje tylko dla firmy zweryfikowanej. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }}
      />
      <div className="container py-6 md:py-10">
        <Breadcrumbs
          ariaLabel={tCommon('breadcrumb')}
          items={[
            { label: tCommon('home'), href: '/' },
            { label: tJobs('pageTitle'), href: JOBS_PATH },
            { label: company.name },
          ]}
        />

        <header className="mt-4 flex items-start gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-soft text-lg font-semibold text-muted-foreground ring-1 ring-inset ring-border"
            aria-hidden="true"
          >
            {initials(company.name)}
          </div>
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
          </div>
        </header>

        <p className="mt-4 max-w-2xl text-muted-foreground">
          {company.description || t('noDescription')}
        </p>

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
            <ul className="pp-job-grid mt-4">
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PublicSavedJobsProvider>
  );
}
