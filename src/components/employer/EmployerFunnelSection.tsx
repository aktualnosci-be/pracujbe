import { getTranslations } from 'next-intl/server';

import { PANEL, PANEL_H2, PANEL_P } from '@/components/dashboard/panel-styles';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { RecruitmentFunnel } from '@/components/employer/RecruitmentFunnel';
import type { FunnelStatsLoad } from '@/lib/data/employer';

/**
 * Lejek rekrutacyjny (pulpit + `/employer/statystyki`). Trzy jawne stany poza danymi: błąd
 * odczytu (ponowienie), brak uprawnień rekrutera (wyjaśnienie zamiast lejka z zerami) i dane.
 */
export async function EmployerFunnelSection({ locale, funnel }: { locale: string; funnel: FunnelStatsLoad }) {
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });

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
