import type { Metadata } from 'next';
import { Briefcase, ClipboardList, MessageSquare, Star } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isSupabaseConfigured } from '@/lib/env';
import {
  getEmployerOverview,
  getFunnelStats,
  DEMO_OVERVIEW_DELTAS,
} from '@/lib/data/employer';
import { StatCard } from '@/components/ui/stat-card';
import { RecruitmentFunnel } from '@/components/employer/RecruitmentFunnel';

/**
 * Panel pracodawcy — Statystyki (rozwinięcie „Zobacz szczegóły" lejka z makiety 05), REALNE dane.
 *
 * Rząd kafelków przeglądowych (`getEmployerOverview`) + pełny lejek rekrutacyjny
 * (`getFunnelStats` + RecruitmentFunnel z konwersjami między etapami). Wszystko pod sesją/RLS;
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

/** Konwersja między etapami lejka (%), zaokrąglona do 1 miejsca. */
function conversionPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export default async function EmployerStatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });

  const configured = isSupabaseConfigured();
  const [overview, funnel] = await Promise.all([getEmployerOverview(), getFunnelStats()]);

  const conversions: [number, number, number] = [
    conversionPct(funnel.applications, funnel.views),
    conversionPct(funnel.interviews, funnel.applications),
    conversionPct(funnel.hired, funnel.interviews),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{td('funnelTitle')}</h1>
      </div>

      {/* Kafelki przeglądowe */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={td('activeOffers')}
          value={overview.activeOffersCount}
          sub={configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.activeOffers })}
          icon={<Briefcase />}
          tone="primary"
        />
        <StatCard
          label={td('newApplications')}
          value={overview.newApplicationsCount}
          sub={
            configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.newApplications })
          }
          icon={<ClipboardList />}
          tone="success"
        />
        <StatCard
          label={td('matchedCandidates')}
          value={overview.matchedCandidatesCount}
          sub={configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.matched })}
          icon={<Star />}
          tone="warning"
        />
        <StatCard
          label={td('messagesToAnswer')}
          value={overview.messagesToAnswerCount}
          sub={configured ? undefined : td('urgent', { count: DEMO_OVERVIEW_DELTAS.urgent })}
          icon={<MessageSquare />}
          tone="error"
        />
      </div>

      {/* Lejek rekrutacyjny */}
      <RecruitmentFunnel
        views={funnel.views}
        applications={funnel.applications}
        interviews={funnel.interviews}
        hired={funnel.hired}
        conversions={conversions}
      />
    </div>
  );
}
