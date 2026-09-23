import type { Metadata } from 'next';
import { ArrowUpRight, BriefcaseBusiness } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { MatchBar } from '@/components/ui/match-bar';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import { Button } from '@/components/ui/button';
import { getRecommendedJobs } from '@/lib/data/candidate';

/**
 * Panel kandydata — polecane oferty i najnowsze oferty zastępcze.
 *
 * Dane realne pod sesją (RLS) z `getRecommendedJobs` (matching + dane publiczne); bez env dane DEMO.
 * NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Akcja zapisu pozostaje podłączona;
 * błąd odczytu nie jest prezentowany jako prawdziwie pusta lista.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navRecommended'),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateRecommendedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  let recommended: Awaited<ReturnType<typeof getRecommendedJobs>> = [];
  let readFailed = false;
  try {
    recommended = await getRecommendedJobs(locale, true);
  } catch {
    readFailed = true;
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="break-words text-3xl font-bold tracking-tight text-foreground">{t('navRecommended')}</h1>
        <p className="text-base text-muted-foreground">{t('recommendedIntro')}</p>
      </header>

      <section aria-label={t('navRecommended')}>
        {readFailed ? (
          <div role="alert" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-foreground">{t('recommendedReadErrorTitle')}</h2>
            <p className="mt-2 text-base text-muted-foreground">{t('recommendedReadErrorBody')}</p>
            <Button asChild variant="outline" className="mt-5 min-h-12 rounded-xl">
              <Link href="/candidate/oferty-polecane">{t('recommendedRetry')}</Link>
            </Button>
          </div>
        ) : recommended.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
            <BriefcaseBusiness className="h-8 w-8 text-accent" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-foreground">{t('recommendedEmptyTitle')}</h2>
            <p className="mt-2 text-base text-muted-foreground">{t('recommendedEmptyBody')}</p>
            <Button asChild className="mt-5 min-h-12 rounded-xl">
              <Link href="/oferty-pracy">{t('recommendedBrowse')}</Link>
            </Button>
          </div>
        ) : (
          <ul aria-label={t('navRecommended')} className="grid gap-4 xl:grid-cols-2">
            {recommended.map((job) => (
              <li key={job.id} className="min-w-0 rounded-3xl border border-border bg-card p-5 sm:p-6">
                <article className="flex h-full min-w-0 flex-col">
                  <header className="flex min-w-0 items-start justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 break-words text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      {job.companyName}
                    </p>
                    <SaveJobButton jobId={job.id} initialSaved={job.saved} className="-mt-2 h-12 w-12 rounded-xl" />
                  </header>
                  <h2 className="mt-3 min-w-0 break-words text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">{job.title}</h2>
                  <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5">
                    <div className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('colLocation')}</dt>
                      <dd className="mt-2 break-words text-base font-semibold text-foreground">{job.city}</dd>
                    </div>
                    <div className="min-w-0 border-l border-border pl-4">
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('colMatch')}</dt>
                      <dd className="mt-2 break-words text-base font-semibold text-foreground">
                        {job.match !== null ? `${job.match}%` : t('recommendedLatest')}
                      </dd>
                    </div>
                  </dl>
                  {job.match !== null ? <MatchBar value={job.match} className="mt-4" /> : null}
                  {job.slug ? (
                    <Link href={`/oferty-pracy/${job.slug}`} className="mt-auto inline-flex min-h-12 items-center justify-between gap-3 pt-5 font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      {t('actionView')}<ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </Link>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
