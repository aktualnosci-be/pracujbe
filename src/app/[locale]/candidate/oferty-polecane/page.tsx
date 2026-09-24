import type { Metadata } from 'next';
import { BriefcaseBusiness } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { MatchBar } from '@/components/ui/match-bar';
import { CandidateJobPassport } from '@/components/candidate/CandidateJobPassport';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { BTN_PRIMARY, BTN_SECONDARY, H2_EXTENDED, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';
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
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  let recommended: Awaited<ReturnType<typeof getRecommendedJobs>> = [];
  let readFailed = false;
  try {
    recommended = await getRecommendedJobs(locale, true);
  } catch {
    readFailed = true;
  }

  return (
    <div className="min-w-0">
      <CandidatePageHeader eyebrow={t('candidatePlaceEyebrow')} title={t('navRecommended')} intro={t('recommendedIntro')} />

      <section aria-label={t('navRecommended')}>
        {readFailed ? (
          <div role="alert" className={PAPER}>
            <h2 className={H2_EXTENDED}>{t('recommendedReadErrorTitle')}</h2>
            <p className={cn(P_EXTENDED, 'mt-2')}>{t('recommendedReadErrorBody')}</p>
            <Link href="/candidate/oferty-polecane" className={cn(BTN_SECONDARY, 'mt-5')}>{t('recommendedRetry')}</Link>
          </div>
        ) : recommended.length === 0 ? (
          <div className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
            <BriefcaseBusiness className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className={cn(H2_EXTENDED, 'mt-4')}>{t('recommendedEmptyTitle')}</h2>
            <p className={cn(P_EXTENDED, 'mt-2')}>{t('recommendedEmptyBody')}</p>
            <Link href="/oferty-pracy" className={cn(BTN_PRIMARY, 'mt-5')}>{t('recommendedBrowse')}</Link>
          </div>
        ) : (
          <ul aria-label={t('navRecommended')} className="pp-job-grid max-[950px]:grid-cols-1">
            {recommended.map((job) => (
              <li key={job.id}>
                <CandidateJobPassport
                  job={job}
                  labels={{ location: tj('passport.location'), viewOffer: tj('passport.viewOffer') }}
                  extra={{
                    label: t('colMatch'),
                    value: job.match !== null ? `${job.match}%` : t('recommendedLatest'),
                  }}
                >
                  {job.match !== null ? <MatchBar value={job.match} className="mt-4" /> : null}
                </CandidateJobPassport>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
