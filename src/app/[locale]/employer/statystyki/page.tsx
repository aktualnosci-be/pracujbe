import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isPortalDataConfigured } from '@/lib/db/portal';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { getEmployerOverview, getFunnelStats, getJobFunnel } from '@/lib/data/employer';
import { parseFunnelRange } from '@/lib/job-funnel/range';
import { EmployerFunnelSection } from '@/components/employer/EmployerFunnelSection';
import { EmployerOverviewStats } from '@/components/employer/EmployerOverviewStats';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { JobFunnelRangePicker, JobFunnelStats } from '@/components/employer/JobFunnelStats';
import {
  EYEBROW,
  H1_EXTENDED,
  PANEL,
  PANEL_H2,
  PANEL_P,
} from '@/components/dashboard/panel-styles';

/**
 * Panel pracodawcy — Statystyki (rozwinięcie „Zobacz szczegóły" lejka z makiety 05), REALNE dane.
 *
 * Rząd kafelków przeglądowych (`getEmployerOverview`) + pełny lejek rekrutacyjny
 * (`getFunnelStats` + RecruitmentFunnel z konwersjami między etapami) oraz lejek ofert (#99,
 * `getJobFunnel`: zakres `?dni=7|30|90`, definicje metryk, rozbicie per oferta). Wszystko pod sesją/RLS;
 * bez env — dane DEMO (delty tygodniowe kafelków tylko w trybie DEMO). Liczniki rekrutacyjne
 * i lejek czyta tylko recruiter+ — zwykły `member` widzi „brak danych” z powodem, nie zera
 * (audyt P1-14). NOINDEX z layoutu panelu. Lejek ofert można pobrać jako CSV dla wybranego
 * zakresu (`/api/employer/job-funnel`); w trybie demo bez przycisku.
 *
 * Tryb ogłoszeniowy (#1147, decyzja produktowa: portal ogłoszeniowy): tylko statystyki ogłoszenia —
 * kafelki aktywnych ofert, wyświetleń i kliknięć „Aplikuj u pracodawcy” oraz lejek ofert bez
 * wysłanych aplikacji; bez lejka rekrutacyjnego (`getFunnelStats` niewywoływany).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    // #1147: tryb ogłoszeniowy — „Statystyki ogłoszeń”, nie „Lejek rekrutacyjny”.
    title: isRecruitmentEnabled('applications') ? t('funnelTitle') : t('listingStatsTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

export default async function EmployerStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const rangeDays = parseFunnelRange((await searchParams)['dni']);

  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  const configured = isPortalDataConfigured();
  const tf = await getTranslations({ locale, namespace: 'jobFunnel' });
  // #1147: tryb ogłoszeniowy — statystyki ogłoszenia; lejka rekrutacyjnego nie ma i nie jest czytany.
  const recruitment = isRecruitmentEnabled('applications');
  const [overview, funnel, jobFunnel] = await Promise.all([
    getEmployerOverview(),
    recruitment ? getFunnelStats() : null,
    getJobFunnel(rangeDays),
  ]);

  return (
    <div className="min-w-0 space-y-[19px]">
      <div>
        <p className={EYEBROW}>{td('employerRole')}</p>
        <h1 className={H1_EXTENDED}>{recruitment ? td('funnelTitle') : td('listingStatsTitle')}</h1>
      </div>

      {/* Kafelki przeglądowe (liczniki rekrutacyjne tylko recruiter+, inaczej „brak danych”) */}
      <EmployerOverviewStats locale={locale} overview={overview} demo={!configured} />

      {/* Lejek rekrutacyjny (tylko tryb RECRUITMENT) */}
      {funnel ? <EmployerFunnelSection locale={locale} funnel={funnel} /> : null}

      {/* Lejek ofert (#99): serwerowy agregat bez śledzenia, zakres dat i definicje metryk. */}
      <JobFunnelRangePicker range={jobFunnel.range} />
      {jobFunnel.status === 'error' ? (
        <EmployerStatsError title={tf('title')} message={tf('loadError')} retryLabel={tc('retry')} />
      ) : jobFunnel.status === 'denied' ? (
        <section className={PANEL}>
          <h2 className={PANEL_H2}>{tf('title')}</h2>
          <p className={`mt-2 ${PANEL_P}`}>{tf('denied')}</p>
        </section>
      ) : (
        <JobFunnelStats
          range={jobFunnel.range}
          totals={jobFunnel.totals}
          jobs={jobFunnel.jobs}
          locale={locale}
          exportHref={
            configured
              ? `/api/employer/job-funnel?${new URLSearchParams({ dni: String(jobFunnel.range.days), locale })}`
              : undefined
          }
        />
      )}
    </div>
  );
}
