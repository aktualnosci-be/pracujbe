import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SearchX } from 'lucide-react';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobs, type CategoryKey, type ContractType } from '@/lib/jobs';
import { FiltersBar } from '@/components/public/FiltersBar';
import { Pagination } from '@/components/public/Pagination';
import { JobCard } from '@/components/public/JobCard';

/**
 * Lista ofert pracy (SSR). Filtry czytane są z `searchParams` i zapisywane w URL
 * (FiltersBar), dzięki czemu wyniki są renderowane po stronie serwera, a adres jest
 * współdzielony (link/odświeżenie). Działa BEZ zmiennych środowiskowych — `getJobs`
 * korzysta wtedy z danych demonstracyjnych.
 *
 * TODO(i18n-slugs): docelowo segment lokalizowany (nl: `vacatures`, fr: `offres-emploi`,
 * en: `jobs`) przez `pathnames` w konfiguracji next-intl. Na teraz jeden segment
 * `oferty-pracy` dla wszystkich języków (prostota, mapa drogowa: spec 12).
 */

const BASE_PATH = '/oferty-pracy';

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

const CONTRACT_TYPES: readonly ContractType[] = [
  'permanent',
  'temporary',
  'interim',
  'freelance',
  'internship',
  'seasonal',
];

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCategory(value: string | undefined): CategoryKey | undefined {
  return value !== undefined && CATEGORY_KEYS.includes(value as CategoryKey)
    ? (value as CategoryKey)
    : undefined;
}

function parseContractType(value: string | undefined): ContractType | undefined {
  return value !== undefined && CONTRACT_TYPES.includes(value as ContractType)
    ? (value as ContractType)
    : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, tMeta] = await Promise.all([
    getTranslations({ locale, namespace: 'jobs' }),
    getTranslations({ locale, namespace: 'metadata' }),
  ]);

  const base = env.siteUrl;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${BASE_PATH}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${BASE_PATH}`;

  const url = `${base}/${locale}${BASE_PATH}`;

  return {
    title: t('pageTitle'),
    description: tMeta('jobsDescription'),
    alternates: { canonical: url, languages },
    openGraph: {
      title: tMeta('jobsTitle'),
      description: tMeta('jobsDescription'),
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      locale,
    },
  };
}

export default async function JobsListPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const keyword = firstValue(sp['keyword'])?.trim() || undefined;
  const city = firstValue(sp['city'])?.trim() || undefined;
  const category = parseCategory(firstValue(sp['category']));
  const contractType = parseContractType(firstValue(sp['contractType']));

  const pageRaw = Number(firstValue(sp['page']));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.trunc(pageRaw) : 1;

  const t = await getTranslations('jobs');

  const result = await getJobs({
    locale,
    keyword,
    city,
    category,
    contractType,
    page,
  });

  const filters: Record<string, string | undefined> = {
    keyword,
    city,
    category,
    contractType,
  };

  return (
    <div className="container py-8 md:py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{t('pageTitle')}</h1>
      </header>

      <div className="mb-6">
        <FiltersBar
          keyword={keyword ?? ''}
          city={city ?? ''}
          category={category}
          contractType={contractType}
        />
      </div>

      <p className="mb-6 text-sm text-muted-foreground" aria-live="polite">
        {t('resultsCount', { count: result.total })}
      </p>

      {result.jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-soft px-6 py-16 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="max-w-md text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {result.jobs.map((job) => (
            <li key={job.id}>
              <JobCard job={job} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath={BASE_PATH}
        page={result.page}
        total={result.total}
        pageSize={result.pageSize}
        filters={filters}
      />
    </div>
  );
}
