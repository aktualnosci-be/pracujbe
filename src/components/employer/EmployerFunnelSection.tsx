import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { PANEL, PANEL_H2, PANEL_P, SECTION_HEAD, TEXT_LINK } from '@/components/dashboard/panel-styles';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { RecruitmentFunnel } from '@/components/employer/RecruitmentFunnel';
import type { FunnelStatsLoad } from '@/lib/data/employer';

/**
 * Lejek rekrutacyjny (pulpit + `/employer/statystyki`). Trzy jawne stany poza danymi: błąd
 * odczytu (ponowienie), brak uprawnień rekrutera (wyjaśnienie zamiast lejka z zerami) i dane.
 * Tryb ogłoszeniowy (#1147, `disabled`): sam odnośnik do statystyk ogłoszeń.
 */
export async function EmployerFunnelSection({ locale, funnel }: { locale: string; funnel: FunnelStatsLoad }) {
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  // #1147: tryb ogłoszeniowy — lejka rekrutacyjnego nie ma; w jego miejscu tylko odnośnik do
  // statystyk ogłoszeń (`/employer/statystyki`), bez żadnych liczników procesu.
  if (funnel.status === 'disabled') {
    return (
      <section className={PANEL} data-testid="employer-listing-stats-link">
        <div className={cn(SECTION_HEAD, 'mb-0')}>
          <h2 className={PANEL_H2}>{td('listingStatsTitle')}</h2>
          <Link href="/employer/statystyki" className={TEXT_LINK}>
            {td('funnelDetails')}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <p className={cn(PANEL_P, 'mt-1.5')}>{td('listingStatsText')}</p>
      </section>
    );
  }

  if (funnel.status === 'error') {
    return (
      <EmployerStatsError title={td('funnelTitle')} message={td('employerFunnelLoadError')} retryLabel={tc('retry')} />
    );
  }
  if (funnel.status === 'denied') {
    return (
      <section className={PANEL}>
        <h2 className={PANEL_H2}>{td('funnelTitle')}</h2>
        <p className={`mt-2 ${PANEL_P}`}>{td('funnelDenied')}</p>
      </section>
    );
  }
  return (
    <RecruitmentFunnel
      views={funnel.funnel.views}
      applications={funnel.funnel.applications}
      interviews={funnel.funnel.interviews}
      hired={funnel.funnel.hired}
    />
  );
}
