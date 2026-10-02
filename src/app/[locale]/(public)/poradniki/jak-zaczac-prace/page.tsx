import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getNavigatorRegions, NAVIGATOR_REVIEW } from '@/lib/guides/start-navigator';
import { buildBreadcrumbListJsonLd, serializeJsonLd } from '@/lib/seo/structured-data';

import { NAVIGATOR_PATH, navigatorMetadata } from './_metadata';

/**
 * Nawigator „Jak zacząć pracę w Belgii?” — krok 1: wybór regionu (#907, SSG, INDEKSOWALNY).
 *
 * Drzewo wyboru działa bez JavaScriptu: region = zwykły link do strony regionu
 * (`/poradniki/jak-zaczac-prace/<region>`), potrzeba = kotwica sekcji na tej stronie. Treść
 * statyczna z `@/lib/guides/start-navigator`, chrome z i18n (`guides.navigator*`).
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
  return navigatorMetadata(locale, NAVIGATOR_PATH, t('navigatorMetaTitle'), t('navigatorMetaDescription'));
}

export default async function StartNavigatorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tCommon, format] = await Promise.all([
    getTranslations('guides'),
    getTranslations('common'),
    getFormatter(),
  ]);

  const regions = getNavigatorRegions(locale);

  const jsonLd = buildBreadcrumbListJsonLd(
    [
      { label: tCommon('home'), href: '/' },
      { label: t('pageTitle'), href: GUIDES_PATH },
      { label: t('navigatorTitle') },
    ],
    { base: env.siteUrl, locale, currentUrl: `${env.siteUrl}/${locale}${NAVIGATOR_PATH}` },
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
          <li aria-current="page" className="min-w-0 truncate text-foreground">{t('navigatorTitle')}</li>
        </ol>
      </nav>

      <header className="max-w-2xl">
        <h1 className="pp-page-title">{t('navigatorTitle')}</h1>
        <p className="mt-2 break-words text-muted-foreground hyphens-auto">{t('navigatorSubtitle')}</p>
      </header>

      <section className="mt-8" aria-labelledby="navigator-regions">
        <h2 id="navigator-regions" className="text-lg font-semibold text-foreground">
          {t('navigatorChooseRegion')}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {regions.map((region) => (
            <li key={region.slug} className="min-w-0">
              <article className="group relative flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:bg-soft focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <h3 className="break-words text-lg font-semibold leading-snug text-foreground hyphens-auto">
                  <Link
                    href={`${NAVIGATOR_PATH}/${region.slug}`}
                    className="after:absolute after:inset-0 after:content-[''] focus-visible:underline focus-visible:outline-none"
                  >
                    {region.name}
                  </Link>
                </h3>
                <p className="mt-2 flex-1 break-words text-sm text-muted-foreground hyphens-auto">{region.summary}</p>
                <ArrowRight className="mt-4 h-4 w-4 text-accent" aria-hidden="true" />
              </article>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-10 max-w-3xl border-t border-border pt-6 text-sm text-muted-foreground">
        <p className="break-words hyphens-auto">{t('navigatorScope')}</p>
        <p className="mt-2">
          <time dateTime={NAVIGATOR_REVIEW.reviewedAt}>
            {t('navigatorReviewed', {
              date: format.dateTime(new Date(NAVIGATOR_REVIEW.reviewedAt), { dateStyle: 'long' }),
            })}
          </time>
        </p>
      </footer>
    </div>
  );
}
