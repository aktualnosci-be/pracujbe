import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowRight, SearchX } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Breadcrumbs } from '@/components/public/Breadcrumbs';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobs, type LocationKey } from '@/lib/jobs';
import { JobCard } from '@/components/public/JobCard';
import { resolveCityAlias } from './city-alias';

/**
 * Landing-page miasta `/praca/miasto/<klucz>` (SSR/SSG, INDEKSOWALNY).
 *
 * Klucz miasta jest stabilny między językami (część adresu), więc hreflang mapuje ten sam
 * segment na wszystkie języki. Nazwa miasta jest tłumaczona (`locations`), a filtr `getJobs`
 * używa zlokalizowanej nazwy (zgodnej z danymi ofert). Zawiera H1, krótki opis (SEO), listę
 * realnych ofert, link do pełnej listy oraz przekierowania krzyżowe do innych miast.
 * Dane strukturalne: BreadcrumbList (Strona główna → Praca → nazwa miasta).
 *
 * Działa BEZ zmiennych środowiskowych — `getJobs` zwraca dane demonstracyjne.
 */

const HUB_PATH = '/praca';
const CITY_BASE = '/praca/miasto';
const JOBS_PATH = '/oferty-pracy';
const LIST_LIMIT = 12;

const LOCATION_KEYS: readonly LocationKey[] = [
  'brussels',
  'antwerp',
  'ghent',
  'leuven',
  'mechelen',
  'hasselt',
  'liege',
  'charleroi',
  'bruges',
  'kortrijk',
];

function isLocationKey(value: string): value is LocationKey {
  return (LOCATION_KEYS as readonly string[]).includes(value);
}

type PageProps = {
  params: Promise<{ locale: string; city: string }>;
};

export function generateStaticParams(): Array<{ locale: string; city: string }> {
  const params: Array<{ locale: string; city: string }> = [];
  for (const locale of routing.locales) {
    for (const city of LOCATION_KEYS) {
      params.push({ locale, city });
    }
  }
  return params;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, city } = await params;
  if (!isLocationKey(city)) {
    return { robots: { index: false, follow: false } };
  }

  const [t, tLoc] = await Promise.all([
    getTranslations({ locale, namespace: 'landing' }),
    getTranslations({ locale, namespace: 'locations' }),
  ]);
  const name = tLoc(city);

  const base = env.siteUrl;
  const path = `${CITY_BASE}/${city}`;
  const url = `${base}/${locale}${path}`;
  const shareImage = new URL('/og.png', base).href;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  const title = t('cityMetaTitle', { name });
  const description = t(`city_${city}`);

  return {
    title,
    description,
    alternates: { canonical: url, languages },
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

export default async function CityLandingPage({ params }: PageProps) {
  const { locale, city } = await params;
  setRequestLocale(locale);

  if (!isLocationKey(city)) {
    // Nazwa miasta w dowolnym języku / inna wielkość liter → kanoniczny adres z kluczem.
    const alias = await resolveCityAlias(city, LOCATION_KEYS);
    if (alias) permanentRedirect(`/${locale}${CITY_BASE}/${alias}`);
    notFound();
  }

  const [t, tLoc, tJobs, tCommon] = await Promise.all([
    getTranslations('landing'),
    getTranslations('locations'),
    getTranslations('jobs'),
    getTranslations('common'),
  ]);

  const name = tLoc(city);
  const result = await getJobs({ locale, city: name, page: 1, pageSize: LIST_LIMIT });

  const otherCities = LOCATION_KEYS.filter((key) => key !== city);

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: tCommon('home'),
        item: `${env.siteUrl}/${locale}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: t('breadcrumbHub'),
        item: `${env.siteUrl}/${locale}${HUB_PATH}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name,
        item: `${env.siteUrl}/${locale}${CITY_BASE}/${city}`,
      },
    ],
  };

  return (
    <PublicSavedJobsProvider key={JSON.stringify(result.jobs.map(job => job.id))} jobIds={result.jobs.map(job => job.id)}>
    <div className="container py-6 md:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Breadcrumb */}
      <Breadcrumbs
        ariaLabel={tCommon('breadcrumb')}
        items={[
          { label: tCommon('home'), href: '/' },
          { label: t('breadcrumbHub'), href: HUB_PATH },
          { label: name },
        ]}
      />

      {/* Nagłówek */}
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t('cityHeading', { name })}
        </h1>
        <p className="mt-2 text-muted-foreground">{t(`city_${city}`)}</p>
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          {tJobs('resultsCount', { count: result.total })}
        </p>
      </header>

      {/* Lista ofert */}
      <section className="mt-6" aria-labelledby="landing-jobs-heading">
        <h2 id="landing-jobs-heading" className="sr-only">
          {t('availableJobs')}
        </h2>
        {result.jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-soft px-6 py-16 text-center">
            <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-md text-muted-foreground">{t('empty')}</p>
            <Link
              href={JOBS_PATH}
              className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              {t('viewAllJobs')}
            </Link>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {result.jobs.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Link
                href={{ pathname: JOBS_PATH, query: { city: name } }}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                {t('seeAllCity', { name })}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </>
        )}
      </section>

      {/* Inne miasta — linkowanie wewnętrzne */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-foreground">{t('otherCities')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {otherCities.map((key) => (
            <li key={key}>
              <Link
                href={`${CITY_BASE}/${key}`}
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-soft px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {tLoc(key)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
    </PublicSavedJobsProvider>
  );
}
