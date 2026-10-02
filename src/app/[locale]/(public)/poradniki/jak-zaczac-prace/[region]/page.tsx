import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import {
  getNavigatorRegionGuide,
  getNavigatorRegions,
  NAVIGATOR_REGIONS,
  NAVIGATOR_REVIEW,
} from '@/lib/guides/start-navigator';
import { buildBreadcrumbListJsonLd, serializeJsonLd } from '@/lib/seo/structured-data';

import { NAVIGATOR_PATH, navigatorMetadata } from '../_metadata';

/**
 * Nawigator „Jak zacząć pracę w Belgii?” — krok 2 dla regionu (#907, SSG, INDEKSOWALNY).
 *
 * Lista potrzeb = kotwice do sekcji (bez JavaScriptu); każda sekcja: kroki wspólne dla Belgii
 * + fakty TEGO regionu. Nieznany region → 404. Zastrzeżenie zakresu i data przeglądu treści
 * na końcu strony (granice z #907: bez oceny statusu, uprawnień i równoważności dyplomu).
 */

const GUIDES_PATH = '/poradniki';
const JOBS_PATH = '/oferty-pracy';

type PageProps = {
  params: Promise<{ locale: string; region: string }>;
};

export function generateStaticParams(): Array<{ locale: string; region: string }> {
  return routing.locales.flatMap((locale) => NAVIGATOR_REGIONS.map((region) => ({ locale, region })));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, region } = await params;
  const guide = getNavigatorRegionGuide(region, locale);
  if (!guide) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'guides' });
  return navigatorMetadata(
    locale,
    `${NAVIGATOR_PATH}/${guide.slug}`,
    t('navigatorRegionMetaTitle', { region: guide.name }),
    t('navigatorRegionMetaDescription', { region: guide.name }),
  );
}

export default async function StartNavigatorRegionPage({ params }: PageProps) {
  const { locale, region } = await params;
  setRequestLocale(locale);

  const guide = getNavigatorRegionGuide(region, locale);
  if (!guide) notFound();

  const [t, tCommon, format] = await Promise.all([
    getTranslations('guides'),
    getTranslations('common'),
    getFormatter(),
  ]);

  const title = t('navigatorRegionTitle', { region: guide.name });
  const otherRegions = getNavigatorRegions(locale).filter((item) => item.slug !== guide.slug);
  const canonical = `${env.siteUrl}/${locale}${NAVIGATOR_PATH}/${guide.slug}`;

  const jsonLd = buildBreadcrumbListJsonLd(
    [
      { label: tCommon('home'), href: '/' },
      { label: t('pageTitle'), href: GUIDES_PATH },
      { label: t('navigatorTitle'), href: NAVIGATOR_PATH },
      { label: guide.name },
    ],
    { base: env.siteUrl, locale, currentUrl: canonical },
  );

  return (
    <div className="container py-6 md:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />

      <nav aria-label={tCommon('breadcrumb')} className="mb-4 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="transition-colors hover:text-foreground">
              {tCommon('home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={GUIDES_PATH} className="transition-colors hover:text-foreground">
              {t('pageTitle')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={NAVIGATOR_PATH} className="transition-colors hover:text-foreground">
              {t('navigatorTitle')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="min-w-0 truncate text-foreground">{guide.name}</li>
        </ol>
      </nav>

      <article className="mx-auto max-w-3xl">
        <header>
          <h1 className="pp-page-title">{title}</h1>
          <p className="mt-3 break-words text-lg text-muted-foreground hyphens-auto">{guide.summary}</p>
        </header>

        <nav aria-labelledby="navigator-needs" className="mt-8">
          <h2 id="navigator-needs" className="text-lg font-semibold text-foreground">
            {t('navigatorChooseNeed')}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {guide.needs.map((need) => (
              <li key={need.key} className="min-w-0">
                <a
                  href={`#${need.key}`}
                  className="block h-full rounded-lg border border-border bg-card p-4 transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="block break-words font-semibold text-foreground hyphens-auto">{need.title}</span>
                  <span className="mt-1 block break-words text-sm text-muted-foreground hyphens-auto">
                    {need.summary}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {guide.needs.map((need) => (
          <section
            key={need.key}
            id={need.key}
            aria-labelledby={`${need.key}-title`}
            className="mt-10 scroll-mt-24 border-t border-border pt-6"
          >
            <h2
              id={`${need.key}-title`}
              className="break-words text-xl font-bold tracking-tight text-foreground md:text-2xl hyphens-auto"
            >
              {need.title}
            </h2>
            <h3 className="mt-4 text-base font-semibold text-foreground">{t('navigatorSteps')}</h3>
            <ol className="mt-2 list-decimal space-y-2 break-words pl-5 text-base leading-relaxed text-muted-foreground marker:text-accent hyphens-auto">
              {need.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            <h3 className="mt-6 text-base font-semibold text-foreground">{t('navigatorRegionFacts')}</h3>
            <ul className="mt-2 list-disc space-y-2 break-words pl-5 text-base leading-relaxed text-muted-foreground marker:text-accent hyphens-auto">
              {need.regionFacts.map((fact, index) => (
                <li key={index}>{fact}</li>
              ))}
            </ul>
          </section>
        ))}

        <div className="mt-10 border-t border-border pt-6">
          <Link
            href={JOBS_PATH}
            className={buttonVariants()}
          >
            {t('navigatorBrowseJobs')}
          </Link>
        </div>

        <section aria-labelledby="navigator-other-regions" className="mt-8">
          <h2 id="navigator-other-regions" className="text-lg font-semibold text-foreground">
            {t('navigatorOtherRegions')}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {otherRegions.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`${NAVIGATOR_PATH}/${item.slug}`}
                  className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          <p className="break-words hyphens-auto">{t('navigatorScope')}</p>
          <p className="mt-2">
            <time dateTime={NAVIGATOR_REVIEW.reviewedAt}>
              {t('navigatorReviewed', {
                date: format.dateTime(new Date(NAVIGATOR_REVIEW.reviewedAt), { dateStyle: 'long' }),
              })}
            </time>
          </p>
          <Link
            href={NAVIGATOR_PATH}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('navigatorBackToRegions')}
          </Link>
        </footer>
      </article>
    </div>
  );
}
