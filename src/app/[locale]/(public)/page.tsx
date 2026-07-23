import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getLatestJobs } from '@/lib/jobs';
import { BelgiumSkyline } from '@/components/brand/BelgiumSkyline';
import { Benefits } from '@/components/public/Benefits';
import { CategoryGrid } from '@/components/public/CategoryGrid';
import { ForCompanies } from '@/components/public/ForCompanies';
import { HeroSearch } from '@/components/public/HeroSearch';
import { HowItWorks } from '@/components/public/HowItWorks';
import { JobCard } from '@/components/public/JobCard';
import { LocationGrid } from '@/components/public/LocationGrid';

/**
 * Strona główna Pracuj.be — redesign wg makiety `docs/design/screens/01-home.png`.
 *
 * Lekka, mobile-first, w większości serwerowa (RSC). Sekcje w kolejności z makiety:
 * Hero (nagłówek + ilustracja Brukseli + wyszukiwarka + linki-akcje) → pasek zaufania →
 * najnowsze oferty (lista-tabela) → popularne kategorie + lokalizacje (2 kolumny) →
 * „Jak to działa?" obok karty „Jesteś pracodawcą?". Stopka jest w layoucie `(public)`.
 *
 * Renderuje się BEZ zmiennych środowiskowych — `getLatestJobs` korzysta z danych
 * demonstracyjnych, gdy Supabase nie jest skonfigurowane.
 */

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

const LATEST_JOBS_LIMIT = 4;
const JOBS_PATH = '/oferty-pracy';

/** Mapowanie locale aplikacji → locale Open Graph (format język_KRAJ). */
const OG_LOCALE: Record<string, string> = {
  pl: 'pl_PL',
  nl: 'nl_BE',
  fr: 'fr_BE',
  en: 'en_GB',
};

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });

  const title = t('homeTitle');
  const description = t('homeDescription');
  const baseUrl = env.siteUrl;
  const canonical = `${baseUrl}/${locale}`;

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = `${baseUrl}/${loc}`;
  }
  languages['x-default'] = `${baseUrl}/${routing.defaultLocale}`;

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: 'Pracuj.be',
      locale: OG_LOCALE[locale] ?? locale,
    },
  };
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tJobs = await getTranslations('jobs');

  const latestJobs = await getLatestJobs(locale, LATEST_JOBS_LIMIT);

  return (
    <main>
      {/* Hero — lekki, nie na cały ekran; ilustracja Brukseli po prawej (desktop). */}
      <section className="relative overflow-hidden border-b border-border bg-soft">
        <div className="container py-12 md:py-16">
          <BelgiumSkyline className="pointer-events-none absolute right-0 top-6 hidden w-2/5 max-w-md text-accent/20 lg:block" />

          <div className="relative max-w-2xl">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-3 max-w-xl text-base text-muted-foreground sm:text-lg">
              {t('heroSubtitle')}
            </p>
          </div>

          {/* Ilustracja pod tekstem na mobile. */}
          <BelgiumSkyline className="mt-8 w-full text-accent/20 lg:hidden" />

          <div className="relative mt-8">
            <HeroSearch />
          </div>
        </div>
      </section>

      {/* Pasek zaufania */}
      <Benefits />

      {/* Najnowsze oferty pracy */}
      <section className="container py-12 md:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t('latestJobsTitle')}
          </h2>
          <Link
            href={JOBS_PATH}
            className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            {t('latestJobsSeeAll')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {latestJobs.length > 0 ? (
          <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {latestJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-dashed border-border bg-soft p-8 text-center text-sm text-muted-foreground">
            {tJobs('empty')}
          </p>
        )}
      </section>

      {/* Popularne kategorie + lokalizacje (2 kolumny) */}
      <section className="border-t border-border bg-soft">
        <div className="container py-12 md:py-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
            <CategoryGrid />
            <LocationGrid />
          </div>
        </div>
      </section>

      {/* Jak to działa? + Jesteś pracodawcą? */}
      <section className="container py-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-[1.8fr_1fr] lg:items-start lg:gap-10">
          <HowItWorks />
          <ForCompanies />
        </div>
      </section>
    </main>
  );
}
