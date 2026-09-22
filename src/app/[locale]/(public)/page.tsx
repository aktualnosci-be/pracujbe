import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getLatestJobs } from '@/lib/jobs';
import { Benefits } from '@/components/public/Benefits';
import { CategoryGrid } from '@/components/public/CategoryGrid';
import { ForCompanies } from '@/components/public/ForCompanies';
import { HeroSearch } from '@/components/public/HeroSearch';
import { HowItWorks } from '@/components/public/HowItWorks';
import { JobCard } from '@/components/public/JobCard';
import { LocationGrid } from '@/components/public/LocationGrid';

/**
 * Strona główna Pracuj.be — hero według `docs/design/people-passport`.
 *
 * Lekka, mobile-first, w większości serwerowa (RSC). Sekcje w kolejności z makiety:
 * Hero (nagłówek + fotografia zespołu + wyszukiwarka + linki-akcje) → pasek zaufania →
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
  const shareImage = new URL('/og.png', baseUrl).href;

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
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [shareImage] },
  };
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tJobs = await getTranslations('jobs');

  const latestJobs = await getLatestJobs(locale, LATEST_JOBS_LIMIT);

  return (
    // Bez własnego <main> — layout (public) już dostarcza landmark <main> (unikamy duplikatu, a11y).
    <PublicSavedJobsProvider key={JSON.stringify(latestJobs.map(job => job.id))} jobIds={latestJobs.map(job => job.id)}>
      {/* Fotografia jest ilustracyjna, nie przedstawia konkretnej oferty ani pracodawcy. */}
      <section className="border-b border-border bg-background">
        <div className="container py-8 md:py-12">
          <div className="grid items-center gap-8 md:grid-cols-[1.16fr_1fr] lg:gap-12">
            <div className="min-w-0">
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {t('heroTitle')}
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                {t('heroSubtitle')}
              </p>
            </div>
            <div className="relative aspect-[3/2] overflow-hidden rounded-3xl rounded-tl-[5rem] bg-soft md:aspect-[4/3] lg:rounded-tl-[6rem]">
              <Image
                src="/images/people/team.webp"
                alt=""
                fill
                priority
                sizes="(min-width: 1280px) 520px, (min-width: 768px) 45vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>
          <div className="mt-8">
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
    </PublicSavedJobsProvider>
  );
}
