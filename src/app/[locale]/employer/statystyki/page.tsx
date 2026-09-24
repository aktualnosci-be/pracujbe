import type { Metadata } from 'next';
import { Briefcase, ClipboardList, MessageSquare, Star } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isSupabaseConfigured } from '@/lib/env';
import {
  getEmployerOverview,
  getFunnelStats,
  getJobFunnel,
  DEMO_OVERVIEW_DELTAS,
} from '@/lib/data/employer';
import { parseFunnelRange } from '@/lib/job-funnel/range';
import { StatCard } from '@/components/ui/stat-card';
import { RecruitmentFunnel } from '@/components/employer/RecruitmentFunnel';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { JobFunnelRangePicker, JobFunnelStats } from '@/components/employer/JobFunnelStats';

/**
 * Panel pracodawcy — Statystyki (rozwinięcie „Zobacz szczegóły" lejka z makiety 05), REALNE dane.
 *
 * Rząd kafelków przeglądowych (`getEmployerOverview`) + pełny lejek rekrutacyjny
 * (`getFunnelStats` + RecruitmentFunnel z konwersjami między etapami) oraz lejek ofert (#99,
 * `getJobFunnel`: zakres `?dni=7|30|90`, definicje metryk, rozbicie per oferta). Wszystko pod sesją/RLS;
 * bez env — dane DEMO (delty tygodniowe StatCard tylko w trybie DEMO). NOINDEX z layoutu panelu.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('funnelTitle'),
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

  const configured = isSupabaseConfigured();
  const tf = await getTranslations({ locale, namespace: 'jobFunnel' });
  const [overview, funnel, jobFunnel] = await Promise.all([
    getEmployerOverview(),
    getFunnelStats(),
    getJobFunnel(rangeDays),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{td('funnelTitle')}</h1>
      </div>

      {/* Kafelki przeglądowe */}
      {overview.status === 'error' ? (
        <EmployerStatsError message={td('employerOverviewLoadError')} retryLabel={tc('retry')} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
          <StatCard
            label={td('activeOffers')}
            value={overview.overview.activeOffersCount}
            sub={configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.activeOffers })}
            icon={<Briefcase />}
            tone="primary"
          />
          <StatCard
            label={td('newApplications')}
            value={overview.overview.newApplicationsCount}
            sub={
              configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.newApplications })
            }
            icon={<ClipboardList />}
            tone="success"
          />
          <StatCard
            label={td('matchedCandidates')}
            value={overview.overview.matchedCandidatesCount}
            sub={configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.matched })}
            icon={<Star />}
            tone="warning"
          />
          <StatCard
            label={td('messagesToAnswer')}
            value={overview.overview.messagesToAnswerCount}
            sub={configured ? undefined : td('urgent', { count: DEMO_OVERVIEW_DELTAS.urgent })}
            icon={<MessageSquare />}
            tone="error"
          />
        </div>
      )}

      {/* Lejek rekrutacyjny */}
      {funnel.status === 'error' ? (
        <EmployerStatsError
          title={td('funnelTitle')}
          message={td('employerFunnelLoadError')}
          retryLabel={tc('retry')}
        />
      ) : (
        <RecruitmentFunnel
          views={funnel.funnel.views}
          applications={funnel.funnel.applications}
          interviews={funnel.funnel.interviews}
          hired={funnel.funnel.hired}
        />
      )}

      {/* Lejek ofert (#99): serwerowy agregat bez śledzenia, zakres dat i definicje metryk. */}
      <JobFunnelRangePicker range={jobFunnel.range} />
      {jobFunnel.status === 'error' ? (
        <EmployerStatsError title={tf('title')} message={tf('loadError')} retryLabel={tc('retry')} />
      ) : jobFunnel.status === 'denied' ? (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">{tf('title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{tf('denied')}</p>
        </section>
      ) : (
        <JobFunnelStats
          range={jobFunnel.range}
          totals={jobFunnel.totals}
          jobs={jobFunnel.jobs}
          locale={locale}
        />
      )}
    </div>
  );
}
