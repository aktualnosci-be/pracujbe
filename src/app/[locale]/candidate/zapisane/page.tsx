import type { Metadata } from 'next';
import { Bookmark } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { CandidateJobPassport } from '@/components/candidate/CandidateJobPassport';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { BTN_PRIMARY, BTN_SECONDARY, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';
import { getSavedJobs } from '@/lib/data/candidate';

/**
 * Panel kandydata — Zapisane oferty (makieta 04, nawigacja „Zapisane oferty").
 *
 * Dane realne pod sesją (RLS: własne `saved_jobs`) z `getSavedJobs`, wzbogacone o dane publiczne
 * oferty; bez env dane DEMO. NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Zapis oferty
 * przez `SaveJobButton` (odznaczenie usuwa z listy po odświeżeniu); teksty z i18n (`dashboard`).
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
    title: t('navSaved'),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateSavedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  const saved = await getSavedJobs(locale);

  return (
    <div className="min-w-0">
      <CandidatePageHeader eyebrow={t('candidatePlaceEyebrow')} title={t('navSaved')} intro={t('savedIntro')} />

      {/* `savedScreen()`: `.p-job-grid` z kartami-paszportami albo `.paper.empty`. */}
      {saved.status === 'error' ? (
        <section role="alert" className={PAPER}>
          <p className={cn(P_EXTENDED, 'text-foreground')}>{t('savedError')}</p>
          <Link href="/candidate/zapisane" className={cn(BTN_SECONDARY, 'mt-4')}>{t('savedRetry')}</Link>
        </section>
      ) : saved.jobs.length === 0 ? (
        <section className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
          <Bookmark className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
          <p className={cn(P_EXTENDED, 'mt-3')}>{t('savedEmpty')}</p>
          <Link href="/oferty-pracy" className={cn(BTN_PRIMARY, 'mt-5')}>{t('savedBrowse')}</Link>
        </section>
      ) : (
        <ul className="pp-job-grid max-[950px]:grid-cols-1">
          {saved.jobs.map((job) => (
            <li key={job.id}>
              <CandidateJobPassport
                job={job}
                labels={{ location: tj('passport.location'), viewOffer: tj('passport.viewOffer') }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
