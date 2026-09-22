import type { Metadata } from 'next';
import {
  ArrowRight,
  Boxes,
  Factory,
  HardHat,
  HeartHandshake,
  type LucideIcon,
  MapPin,
  Sprout,
  SprayCan,
  Truck,
  UtensilsCrossed,
  Warehouse,
  Wrench,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import {
  getCategoryCounts,
  getCityCounts,
  type CategoryKey,
  type LocationKey,
} from '@/lib/jobs';
import { buildHubFacet } from '@/lib/jobs-hub';
import { LandingHubGrid, type LandingHubItem } from '@/components/public/LandingHubGrid';

/**
 * Hub landing-page'y `/praca` (SSR/SSG, INDEKSOWALNY).
 *
 * Spis wszystkich branż i miast z krótkimi opisami i linkami do dedykowanych landing-page'y
 * (`/praca/kategoria/<klucz>`, `/praca/miasto/<klucz>`). Wewnętrzne linkowanie wspiera SEO,
 * a użytkownikowi daje szybki przegląd. Liczniki ofert pochodzą z pełnych zapytań agregujących;
 * w trybie demonstracyjnym są pomijane zamiast udawać dane produkcyjne.
 *
 * Dane strukturalne: BreadcrumbList (Strona główna → Praca).
 */

const HUB_PATH = '/praca';
const CATEGORY_BASE = '/praca/kategoria';
const CITY_BASE = '/praca/miasto';
const JOBS_PATH = '/oferty-pracy';
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

const CATEGORY_ICON: Record<CategoryKey, LucideIcon> = {
  construction: HardHat,
  transport: Truck,
  warehouse: Warehouse,
  production: Factory,
  technical: Wrench,
  cleaning: SprayCan,
  hospitality: UtensilsCrossed,
  care: HeartHandshake,
  logistics: Boxes,
  seasonal: Sprout,
};

type PageProps = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });

  const base = env.siteUrl;
  const url = `${base}/${locale}${HUB_PATH}`;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${HUB_PATH}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${HUB_PATH}`;

  return {
    title: t('hubMetaTitle'),
    description: t('hubMetaDescription'),
    alternates: { canonical: url, languages },
    openGraph: {
      title: t('hubMetaTitle'),
      description: t('hubMetaDescription'),
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      locale,
    },
  };
}

export default async function JobsHubPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tCat, tLoc, tCommon, tHome] = await Promise.all([
    getTranslations('landing'),
    getTranslations('categories'),
    getTranslations('locations'),
    getTranslations('common'),
    getTranslations('home'),
  ]);

  const cityNames = LOCATION_KEYS.map((key) => tLoc(key));
  const [categoryCounts, cityCounts] = await Promise.all([
    getCategoryCounts(locale, CATEGORY_KEYS),
    getCityCounts(locale, cityNames),
  ]);

  const countLabel = (n: number): string | undefined =>
    n > 0 ? tHome('offersCount', { count: n }) : undefined;

  const categoryItems: LandingHubItem[] = CATEGORY_KEYS.map((key) => {
    const Icon = CATEGORY_ICON[key];
    const facet = buildHubFacet(CATEGORY_BASE, key, key, categoryCounts);
    return {
      key,
      href: facet.href,
      title: tCat(key),
      description: t(`cat_${key}`),
      meta: facet.count === undefined ? undefined : countLabel(facet.count),
      icon: <Icon className="h-4 w-4" aria-hidden="true" />,
    };
  });

  const cityItems: LandingHubItem[] = LOCATION_KEYS.map((key) => {
    const name = tLoc(key);
    const facet = buildHubFacet(CITY_BASE, key, name, cityCounts);
    return {
      key,
      href: facet.href,
      title: name,
      description: t(`city_${key}`),
      meta: facet.count === undefined ? undefined : countLabel(facet.count),
      icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
    };
  });

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
    ],
  };

  return (
    <div className="container py-6 md:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Breadcrumb */}
      <nav aria-label={tCommon('breadcrumb')} className="mb-4 text-sm text-muted-foreground">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="transition-colors hover:text-foreground">
              {tCommon('home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{t('breadcrumbHub')}</li>
        </ol>
      </nav>

      {/* Nagłówek */}
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t('hubTitle')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('hubSubtitle')}</p>
      </header>

      {/* Branże */}
      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {t('byCategoryTitle')}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('byCategoryIntro')}</p>
          </div>
        </div>
        <div className="mt-5">
          <LandingHubGrid items={categoryItems} ariaLabel={t('byCategoryTitle')} />
        </div>
      </section>

      {/* Miasta */}
      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {t('byCityTitle')}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('byCityIntro')}</p>
          </div>
        </div>
        <div className="mt-5">
          <LandingHubGrid items={cityItems} ariaLabel={t('byCityTitle')} />
        </div>
      </section>

      {/* CTA — pełna lista */}
      <div className="mt-12">
        <Link
          href={JOBS_PATH}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          {t('viewAllJobs')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
