import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getAllGuides } from '@/lib/guides/guides';
import { GuideCard } from '@/components/public/GuideCard';

/**
 * Lista poradników `/poradniki` (SSG, INDEKSOWALNA).
 *
 * Poradniki to statyczna treść z `@/lib/guides/guides` (bez CMS/DB) — strona renderuje się
 * BEZ zmiennych środowiskowych. Slug jest wspólny między językami, więc hreflang mapuje ten
 * sam segment na wszystkie języki. Dane strukturalne: BreadcrumbList (Strona główna → Poradniki).
 */

const GUIDES_PATH = '/poradniki';

type PageProps = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guides' });

  const base = env.siteUrl;
  const url = `${base}/${locale}${GUIDES_PATH}`;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${GUIDES_PATH}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${GUIDES_PATH}`;

  return {
    title: { absolute: t('metaTitle') },
    description: t('metaDescription'),
    alternates: { canonical: url, languages },
    openGraph: {
      title: t('metaTitle'),
      description: t('metaDescription'),
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      locale,
    },
  };
}

export default async function GuidesListPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tCommon] = await Promise.all([
    getTranslations('guides'),
    getTranslations('common'),
  ]);

  const guides = getAllGuides(locale);

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
        name: t('pageTitle'),
        item: `${env.siteUrl}/${locale}${GUIDES_PATH}`,
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
          <li className="text-foreground">{t('pageTitle')}</li>
        </ol>
      </nav>

      {/* Nagłówek */}
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t('pageTitle')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('pageSubtitle')}</p>
      </header>

      {/* Lista poradników */}
      <section className="mt-8" aria-label={t('pageTitle')}>
        {guides.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-soft px-6 py-16 text-center text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((guide) => (
              <li key={guide.slug} className="min-w-0">
                <GuideCard guide={guide} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
