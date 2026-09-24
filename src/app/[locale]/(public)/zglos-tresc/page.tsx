import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';
import { getJobBySlug } from '@/lib/jobs';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { ContentReportForm } from '@/components/public/ContentReportForm';
import { ReportLegalNote } from '@/components/public/ReportLegalNote';

/**
 * Publiczne zgłoszenie treści (DSA, #41): konkretna oferta albo firma, która ją opublikowała.
 * Wejście ze szczegółu oferty (`?oferta=<slug>&cel=oferta|firma`). Formularz działa bez
 * logowania; ochrona: Turnstile + limiter w akcji, limit i idempotencja w bazie.
 *
 * Strona formularza — `noindex` i poza sitemap. Oferta przykładowa (tryb demo, #297) nie jest
 * treścią serwisu, więc jej nie zgłaszamy. Brak/nieznany slug → wskazówka, skąd zgłaszać.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contentReport' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function ContentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'contentReport' });
  const sp = await searchParams;
  const slug = firstValue(sp['oferta'])?.slice(0, 200);
  const initialTarget = firstValue(sp['cel']) === 'firma' ? 'company' : 'job';
  const job = slug ? await getJobBySlug(slug, locale) : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{t('title')}</h1>
      <p className="mt-3 text-muted-foreground">{t('intro')}</p>
      <ReportLegalNote className="mt-4" />

      <div className="mt-8">
        {!job ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <p className="text-foreground">{t('missingTarget')}</p>
            <Link href="/oferty-pracy" className={cn(buttonVariants({ variant: 'outline' }))}>
              {t('browseJobs')}
            </Link>
          </div>
        ) : job.isDemo ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <p className="text-foreground">{t('demoNotice')}</p>
            <Link href={`/oferty-pracy/${job.slug}`} className={cn(buttonVariants({ variant: 'outline' }))}>
              {t('backToJob')}
            </Link>
          </div>
        ) : (
          <ContentReportForm
            jobId={job.id}
            jobTitle={job.title}
            companyName={job.companyName}
            jobSlug={job.slug}
            jobUrl={`${env.siteUrl}/${locale}/oferty-pracy/${job.slug}`}
            initialTarget={initialTarget}
          />
        )}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        {t.rich('lookupPrompt', {
          link: (chunks) => (
            <Link href="/zglos-tresc/sprawa" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
