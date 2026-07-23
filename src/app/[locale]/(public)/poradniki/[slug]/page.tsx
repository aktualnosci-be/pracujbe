import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import {
  getAllGuides,
  getAllGuideSlugs,
  getGuideBySlug,
  type GuideCategory,
} from '@/lib/guides/guides';
import { GuideCard } from '@/components/public/GuideCard';
import { GuideContent } from '@/components/public/GuideContent';

/**
 * Artykuł poradnika `/poradniki/<slug>` (SSG, INDEKSOWALNY).
 *
 * Treść statyczna z `@/lib/guides/guides` (bez CMS/DB) — renderuje się BEZ zmiennych
 * środowiskowych. `generateStaticParams` generuje strony dla każdego języka × slug; nieznany
 * slug → 404 (i `noindex` w metadanych). Dane strukturalne: Article (headline, datePublished,
 * inLanguage, author = Pracuj.be) + BreadcrumbList. Slug wspólny między językami → hreflang
 * mapuje ten sam segment.
 */

const GUIDES_PATH = '/poradniki';
const RELATED_LIMIT = 3;

/** Mapowanie kategorii na klucz etykiety w namespace `guides`. */
const CATEGORY_LABEL_KEY: Record<GuideCategory, string> = {
  jobSearch: 'catJobSearch',
  contracts: 'catContracts',
  housing: 'catHousing',
  admin: 'catAdmin',
  driving: 'catDriving',
  safety: 'catSafety',
};

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export function generateStaticParams(): Array<{ locale: string; slug: string }> {
  const params: Array<{ locale: string; slug: string }> = [];
  for (const locale of routing.locales) {
    for (const slug of getAllGuideSlugs()) {
      params.push({ locale, slug });
    }
  }
  return params;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const guide = getGuideBySlug(slug, locale);

  if (!guide) {
    return { robots: { index: false, follow: false } };
  }

  const base = env.siteUrl;
  const path = `${GUIDES_PATH}/${slug}`;
  const url = `${base}/${locale}${path}`;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  return {
    title: guide.title,
    description: guide.excerpt,
    alternates: { canonical: url, languages },
    openGraph: {
      title: guide.title,
      description: guide.excerpt,
      url,
      siteName: 'Pracuj.be',
      type: 'article',
      locale,
      publishedTime: guide.publishedAt,
    },
  };
}

export default async function GuideArticlePage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const guide = getGuideBySlug(slug, locale);
  if (!guide) {
    notFound();
  }

  const [t, tCommon, format] = await Promise.all([
    getTranslations('guides'),
    getTranslations('common'),
    getFormatter(),
  ]);

  const publishedDate = new Date(guide.publishedAt);
  const related = getAllGuides(locale)
    .filter((item) => item.slug !== guide.slug)
    .slice(0, RELATED_LIMIT);

  const canonical = `${env.siteUrl}/${locale}${GUIDES_PATH}/${slug}`;

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.excerpt,
    datePublished: guide.publishedAt,
    inLanguage: locale,
    author: { '@type': 'Organization', name: 'Pracuj.be' },
    publisher: { '@type': 'Organization', name: 'Pracuj.be' },
    mainEntityOfPage: canonical,
  };

  const breadcrumbJsonLd = {
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
        name: t('pageTitle'),
        item: `${env.siteUrl}/${locale}${GUIDES_PATH}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: guide.title,
        item: canonical,
      },
    ],
  };

  return (
    <div className="container py-6 md:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c'),
        }}
      />

      {/* Breadcrumb */}
      <nav aria-label="breadcrumb" className="mb-4 text-sm text-muted-foreground">
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
          <li className="min-w-0 truncate text-foreground">{guide.title}</li>
        </ol>
      </nav>

      <article className="mx-auto max-w-3xl">
        <header>
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
            {t(CATEGORY_LABEL_KEY[guide.category])}
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            {guide.title}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">{guide.excerpt}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <time dateTime={guide.publishedAt}>
              {t('published', { date: format.dateTime(publishedDate, { dateStyle: 'long' }) })}
            </time>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {t('readingTime', { minutes: guide.readingMinutes })}
            </span>
          </div>
        </header>

        <GuideContent body={guide.body} />

        <div className="mt-10 border-t border-border pt-6">
          <Link
            href={GUIDES_PATH}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('backToList')}
          </Link>
        </div>
      </article>

      {/* Powiązane poradniki */}
      {related.length > 0 ? (
        <section className="mx-auto mt-12 max-w-5xl border-t border-border pt-8">
          <h2 className="text-lg font-semibold text-foreground">{t('moreGuides')}</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <li key={item.slug} className="min-w-0">
                <GuideCard guide={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
