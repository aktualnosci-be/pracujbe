import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { brandShareImageUrl } from '@/lib/seo/structured-data';
import { getLatestJobs, isShowingDemoJobs } from '@/lib/jobs';
import { DemoJobsNotice } from '@/components/public/DemoJobsNotice';

import { Benefits } from '@/components/public/Benefits';
import { CategoryGrid } from '@/components/public/CategoryGrid';
import { ForCompanies } from '@/components/public/ForCompanies';
import { HeroSearch } from '@/components/public/HeroSearch';
import { HomeEntryPoints } from '@/components/public/HomeEntryPoints';
import { HowItWorks } from '@/components/public/HowItWorks';
import { JobCard } from '@/components/public/JobCard';
import { LocationGrid } from '@/components/public/LocationGrid';

/**
 * Strona główna Pracuj.be — hero według `docs/design/people-passport`.
 *
 * Lekka, mobile-first, w większości serwerowa (RSC). Kolejność wg prototypu „Ludzie i praca”
 * (`people.js` + `conditions.css`): hero (teza + fotografia) → wyszukiwarka w jednym
 * kontenerze → najnowsze oferty na szarym tle w siatce paszportów (2 kolumny od `lg`, 1 niżej)
 * → wejścia „Utwórz profil / Dodaj ofertę” + pasek zaufania (prototyp nie ma ich w hero) →
 * popularne kategorie + lokalizacje → „Jak to działa?" obok karty „Jesteś pracodawcą?".
 * Stopka jest w layoucie `(public)`.
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

/** ISR (#298): oferty zmieniają się w ciągu dnia — HTML z cache, odświeżany co 60 s. */
export const revalidate = 60;

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });

  const title = t('homeTitle');
  const description = t('homeDescription');
  const baseUrl = env.siteUrl;
  const canonical = `${baseUrl}/${locale}`;
  const shareImage = brandShareImageUrl(baseUrl);

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = `${baseUrl}/${loc}`;
  }
  languages['x-default'] = `${baseUrl}/${routing.defaultLocale}`;

  return {
    title: { absolute: title },
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
      {/*
        Hero wg `people.js` (#166): trzywierszowa teza, opis, czerwona akcja główna + link do
        rejestracji kandydata, fotografia na wysokość kolumny tekstu z podpisem na zdjęciu.
        Fotografia jest ilustracyjna, nie przedstawia konkretnej oferty ani pracodawcy.
        Zdjęcie leży pod podpisem (absolute), a wysokość figury wyznacza min-h + podpis w
        przepływie — przy powiększeniu tekstu figura rośnie zamiast ucinać podpis, a stała
        minimalna wysokość chroni CLS i LCP (zdjęcie z priority, bez zmiany rozmiaru po załadowaniu).
      */}
      <section className="bg-background">
        <div className="container pb-8 pt-8 md:pb-9 md:pt-10">
          <div className="grid gap-8 md:grid-cols-[1.16fr_1fr] md:items-stretch lg:gap-12">
            <div className="flex min-w-0 flex-col justify-center">
              <p className="mb-5 text-xs font-bold uppercase tracking-[0.06em] text-primary">
                {t('heroEyebrow')}
              </p>
              {/* Trzeci wiersz w czerwieni marki (--primary ≈ #D92932): kontrast z bielą 4,9:1,
                  czyli AA także dla zwykłego tekstu, a nagłówek to tekst duży (≥ 3:1). */}
              <h1 className="text-[2.3125rem] font-[750] leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.5rem] xl:text-[4.0625rem]">
                <span className="block">{t('heroTitleLine1')}</span>{' '}
                <span className="block">{t('heroTitleLine2')}</span>{' '}
                <span className="block text-primary">{t('heroTitleLine3')}</span>
              </h1>
              <p className="mt-6 max-w-[29rem] text-base leading-relaxed text-muted-foreground sm:text-[1.0625rem] sm:leading-[1.65]">
                {t('heroSubtitle')}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link
                  href={JOBS_PATH}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {t('heroBrowseJobs')}
                </Link>
                {/* Drugi wybór jako zwykły link tekstowy (`.text-link` z prototypu) — bez
                    podkreślenia i strzałki; podkreślenie tylko przy najechaniu. Obok przycisku,
                    więc rozpoznawalny po położeniu i wadze fontu (WCAG 1.4.1 nie dotyczy
                    linków poza blokiem tekstu). */}
                <Link
                  href="/rejestracja"
                  className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {t('heroCreateProfile')}
                </Link>
              </div>
            </div>
            {/* Zaokrąglenie jak `.p-hero-photo`: 100 px w lewym górnym rogu, 22 px w pozostałych
                (55 px na telefonie, 75 px przy średnich szerokościach). */}
            <figure className="relative flex min-h-64 min-w-0 flex-col justify-end overflow-hidden rounded-[1.125rem] rounded-tl-[3.4375rem] bg-soft p-3 sm:min-h-80 sm:p-4 md:min-h-[22rem] md:rounded-[1.375rem] md:rounded-tl-[4.6875rem] lg:rounded-tl-[6.25rem] lg:p-5">
              <Image
                src="/images/people/team.webp"
                alt=""
                fill
                priority
                sizes="(min-width: 1280px) 560px, (min-width: 768px) 45vw, 100vw"
                className="object-cover"
              />
              <figcaption className="relative flex items-center gap-3 rounded-xl bg-background px-4 py-3 text-sm leading-snug text-foreground shadow-lg sm:gap-4 sm:px-5 sm:py-4">
                <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent font-bold text-accent-foreground sm:flex md:hidden lg:flex" aria-hidden="true">.be</span>
                <span className="min-w-0"><strong className="block">{t('heroPhotoCaption')}</strong><span className="mt-0.5 block text-muted-foreground">{t('heroPhotoDisclaimer')}</span></span>
              </figcaption>
            </figure>
          </div>
          <div className="mt-8 md:mt-9">
            <HeroSearch />
          </div>
        </div>
      </section>

      {/* Najnowsze oferty pracy — `.p-offers`: szare tło z liniami góra/dół, siatka paszportów. */}
      <section className="border-y border-border bg-soft">
        <div className="container py-7 md:py-9 lg:pb-11">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[1.625rem] font-[750] leading-tight tracking-[-0.035em] text-foreground sm:text-3xl">
                {t('latestJobsTitle')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t('latestJobsSubtitle')}</p>
            </div>
            <Link
              href={JOBS_PATH}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:self-auto"
            >
              {t('latestJobsSeeAll')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {isShowingDemoJobs() ? <DemoJobsNotice className="mt-6" /> : null}

          {latestJobs.length > 0 ? (
            <ul className="mt-6 grid gap-4 md:mt-7 lg:grid-cols-2 lg:gap-5">
              {latestJobs.map((job) => (
                <li key={job.id} className="flex min-w-0">
                  <JobCard job={job} className="w-full" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 rounded-2xl border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
              {tJobs('empty')}
            </p>
          )}
        </div>
      </section>

      {/* Wejścia dla kandydata i pracodawcy + pasek zaufania (dawniej w hero). */}
      <section className="container space-y-6 py-10 md:py-12">
        <HomeEntryPoints />
        <Benefits />
      </section>

      {/* Popularne kategorie + lokalizacje (2 kolumny) */}
      <section className="border-y border-border bg-soft">
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
