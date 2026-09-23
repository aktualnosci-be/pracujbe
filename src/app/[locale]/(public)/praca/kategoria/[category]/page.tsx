import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, SearchX } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobs, type CategoryKey } from '@/lib/jobs';
import { JobCard } from '@/components/public/JobCard';

/**
 * Landing-page kategorii `/praca/kategoria/<klucz>` (SSR/SSG, INDEKSOWALNY).
 *
 * Klucz kategorii jest stabilny między językami (część adresu), więc hreflang mapuje ten sam
 * segment na wszystkie języki. Zawiera H1 z nazwą branży, krótki opis (SEO), listę realnych
 * ofert z filtrem kategorii oraz link do pełnej listy i przekierowania krzyżowe do innych branż.
 * Dane strukturalne: BreadcrumbList (Strona główna → Praca → nazwa branży).
 *
 * Działa BEZ zmiennych środowiskowych — `getJobs` zwraca dane demonstracyjne.
 */

const HUB_PATH = '/praca';
const CATEGORY_BASE = '/praca/kategoria';
const JOBS_PATH = '/oferty-pracy';
const LIST_LIMIT = 12;

const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
];

function isCategoryKey(value: string): value is CategoryKey {
  return (CATEGORY_KEYS as readonly string[]).includes(value);
}

type PageProps = {
  params: Promise<{ locale: string; category: string }>;
};

export function generateStaticParams(): Array<{ locale: string; category: string }> {
  const params: Array<{ locale: string; category: string }> = [];
  for (const locale of routing.locales) {
    for (const category of CATEGORY_KEYS) {
      params.push({ locale, category });
    }
  }
  return params;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, category } = await params;
  if (!isCategoryKey(category)) {
    return { robots: { index: false, follow: false } };
  }

  const [t, tCat] = await Promise.all([
    getTranslations({ locale, namespace: 'landing' }),
    getTranslations({ locale, namespace: 'categories' }),
  ]);
  const name = tCat(category);

  const base = env.siteUrl;
  const path = `${CATEGORY_BASE}/${category}`;
  const url = `${base}/${locale}${path}`;
  const shareImage = new URL('/og.png', base).href;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  const title = t('categoryMetaTitle', { name });
  const description = t(`cat_${category}`);

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

export default async function CategoryLandingPage({ params }: PageProps) {
  const { locale, category } = await params;
  setRequestLocale(locale);

  if (!isCategoryKey(category)) {
    notFound();
  }

  const [t, tCat, tJobs, tCommon] = await Promise.all([
    getTranslations('landing'),
    getTranslations('categories'),
    getTranslations('jobs'),
    getTranslations('common'),
  ]);

  const name = tCat(category);
  const result = await getJobs({ locale, category, page: 1, pageSize: LIST_LIMIT });

  const otherCategories = CATEGORY_KEYS.filter((key) => key !== category);

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
        item: `${env.siteUrl}/${locale}${CATEGORY_BASE}/${category}`,
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
      <nav aria-label={tCommon('breadcrumb')} className="mb-4 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="transition-colors hover:text-foreground">
              {tCommon('home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={HUB_PATH} className="transition-colors hover:text-foreground">
              {t('breadcrumbHub')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{name}</li>
        </ol>
      </nav>

      {/* Nagłówek */}
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t('categoryHeading', { name })}
        </h1>
        <p className="mt-2 text-muted-foreground">{t(`cat_${category}`)}</p>
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          {tJobs('resultsCount', { count: result.total })}
        </p>
      </header>

      {/* Lista ofert */}
      <section className="mt-6" aria-label={t('availableJobs')}>
        {result.jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-soft px-6 py-16 text-center">
            <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-md text-muted-foreground">{t('empty')}</p>
            <Link
              href={JOBS_PATH}
              className="text-sm font-medium text-accent underline-offset-4 hover:underline"
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
                href={{ pathname: JOBS_PATH, query: { category } }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                {t('seeAllCategory', { name })}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </>
        )}
      </section>

      {/* Inne branże — linkowanie wewnętrzne */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-foreground">{t('otherCategories')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {otherCategories.map((key) => (
            <li key={key}>
              <Link
                href={`${CATEGORY_BASE}/${key}`}
                className="inline-flex items-center rounded-full border border-border bg-soft px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {tCat(key)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
    </PublicSavedJobsProvider>
  );
}
