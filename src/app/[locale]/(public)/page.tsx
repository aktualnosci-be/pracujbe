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
 * Lekka, mobile-first, w większości serwerowa (RSC). Wygląd i kolejność sekcji to kalka
 * prototypu „Ludzie i praca” (`people.js` + `conditions.css`, klasy `.pp-*` w globals.css):
 * hero (teza + fotografia) → wyszukiwarka → najnowsze oferty w siatce paszportów → „W czym
 * jesteś dobry?” (dwie branże + „Profil zamiast CV”). Niżej sekcje aplikacji, których
 * prototyp nie ma (wejścia, pasek zaufania, kategorie, lokalizacje, „Jak to działa?”,
 * karta pracodawcy) — funkcje i linki bez zmian. Stopka jest w layoucie `(public)`.
 *
 * Renderuje się BEZ zmiennych środowiskowych — `getLatestJobs` korzysta z danych
 * demonstracyjnych, gdy Supabase nie jest skonfigurowane.
 */

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

const LATEST_JOBS_LIMIT = 6;
const JOBS_PATH = '/oferty-pracy';

/** Dwie branże z prototypu (`.p-sector`), zdjęcia z `docs/design/people-passport/prototype/assets`. */
const SECTORS = [
  { category: 'logistics', label: 'fieldsLogistics', image: '/images/people/warehouse.webp', height: 1200, className: 'pp-sector-logistics' },
  { category: 'production', label: 'fieldsTechnical', image: '/images/people/workshop.webp', height: 1422, className: 'pp-sector-technical' },
] as const;

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
        Hero — kalka `.p-hero` z `people.js` (klasy .pp-* w globals.css): trzywierszowa teza,
        opis, czerwona akcja + link tekstowy, fotografia z podpisem na zdjęciu. Fotografia jest
        ilustracyjna (podpis mówi to wprost). Podpis w przepływie figury (min-height + padding
        = wcięcie z prototypu): przy powiększeniu figura rośnie zamiast ucinać podpis, a stała
        minimalna wysokość chroni CLS i LCP (zdjęcie z priority).
      */}
      <section className="pp-hero">
        <div className="pp-hero-copy min-w-0">
          <span className="pp-eyebrow">{t('heroEyebrow')}</span>
          <h1>
            <span className="block">{t('heroTitleLine1')}</span>{' '}
            <span className="block">{t('heroTitleLine2')}</span>{' '}
            <span className="pp-accent block">{t('heroTitleLine3')}</span>
          </h1>
          <p>{t('heroSubtitle')}</p>
          <div className="pp-hero-links">
            <Link href={JOBS_PATH} className="pp-btn">
              {t('heroBrowseJobs')}
            </Link>
            <Link href="/rejestracja" className="pp-text-link rounded-sm">
              {t('heroCreateProfile')}
            </Link>
          </div>
        </div>
        <figure className="pp-hero-photo min-w-0">
          <Image
            src="/images/people/team.webp"
            alt=""
            fill
            priority
            sizes="(min-width: 1360px) 580px, (min-width: 601px) 45vw, 100vw"
            className="object-cover object-center"
          />
          <figcaption>
            <span className="pp-caption-icon" aria-hidden="true">.be</span>
            <span className="min-w-0">
              <strong>{t('heroPhotoCaption')}</strong>
              <small>{t('heroPhotoDisclaimer')}</small>
            </span>
          </figcaption>
        </figure>
      </section>

      <section className="pp-search-section" aria-label={t('searchSectionLabel')}>
        <HeroSearch />
      </section>

      {/* Najnowsze oferty — `.p-offers`: szare tło z liniami, siatka paszportów (2 kolumny,
          1 ≤ 950 px — tak renderuje prototyp: conditions.css nadpisuje 3 kolumny z people.css). */}
      <section className="pp-offers">
        <div className="pp-section-head">
          <div className="min-w-0">
            <h2>{t('latestJobsTitle')}</h2>
            <p>{t('latestJobsSubtitle')}</p>
          </div>
          <Link href={JOBS_PATH} className="pp-btn pp-btn-ink shrink-0">
            {/* Jeden element tekstowy jak w prototypie („… oferty →”), bez odstępu flex przed strzałką. */}
            <span>
              {t('latestJobsSeeAll')} <span aria-hidden="true">→</span>
            </span>
          </Link>
        </div>

        {isShowingDemoJobs() ? <DemoJobsNotice className="pp-notice" /> : null}

        {latestJobs.length > 0 ? (
          <ul className="pp-job-grid">
            {latestJobs.map((job) => (
              <li key={job.id}>
                <JobCard job={job} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[20px] border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
            {tJobs('empty')}
          </p>
        )}
      </section>

      {/* „W czym jesteś dobry?” — `.p-fields`: dwie branże ze zdjęciem + „Profil zamiast CV”. */}
      <section className="pp-fields">
        <div className="pp-section-head">
          <div className="min-w-0">
            <h2>{t('fieldsTitle')}</h2>
            <p>{t('fieldsSubtitle')}</p>
          </div>
        </div>
        <div className="pp-sector-grid">
          {SECTORS.map((sector) => (
            <Link
              key={sector.category}
              href={{ pathname: JOBS_PATH, query: { category: sector.category } }}
              className={`pp-sector ${sector.className}`}
            >
              <Image src={sector.image} alt="" width={800} height={sector.height} sizes="(min-width: 761px) 30vw, (min-width: 601px) 50vw, 100vw" />
              <span>
                <strong>{t(sector.label)}</strong>
                <ArrowRight aria-hidden="true" strokeWidth={1.5} />
              </span>
            </Link>
          ))}
          <aside className="pp-profile-note" aria-labelledby="profile-note-title">
            <span className="pp-eyebrow">{t('profileNoteEyebrow')}</span>
            <h2 id="profile-note-title">
              {t.rich('profileNoteTitle', { br: () => <br className="max-[760px]:hidden" /> })}
            </h2>
            <p>{t('profileNoteBody')}</p>
            <Link href="/rejestracja" className="pp-btn">
              {t('profileNoteCta')}
            </Link>
          </aside>
        </div>
      </section>

      {/* Poniżej: sekcje aplikacji spoza prototypu (wejścia, pasek zaufania, kategorie,
          lokalizacje, „Jak to działa?” + karta pracodawcy) — funkcje i linki bez zmian. */}
      <section className="container space-y-6 border-t border-border py-10 md:py-12">
        <HomeEntryPoints />
        <Benefits />
      </section>

      <section className="border-y border-border bg-soft">
        <div className="container py-12 md:py-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
            <CategoryGrid />
            <LocationGrid />
          </div>
        </div>
      </section>

      <section className="container py-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-[1.8fr_1fr] lg:items-start lg:gap-10">
          <HowItWorks />
          <ForCompanies />
        </div>
      </section>
    </PublicSavedJobsProvider>
  );
}
