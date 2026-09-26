import { getTranslations } from 'next-intl/server';

import { PanelStats } from '@/components/dashboard/PanelStats';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { DEMO_OVERVIEW_DELTAS, type EmployerOverviewLoad } from '@/lib/data/employer';

/**
 * Kafelki przeglądowe pracodawcy — wspólne dla pulpitu i `/employer/statystyki`.
 *
 * Liczniki rekrutacyjne bywają niedostępne (`null`): zwykły `member` nie czyta zgłoszeń,
 * dopasowań ani rozmów (RLS 0039), a dopasowani kandydaci są dostępni dopiero dla firmy
 * zweryfikowanej. Wtedy kafelek pokazuje „brak danych” i powód, nigdy 0 — zero znaczyłoby
 * „nikt nie aplikował”, co nie jest prawdą. Delty tygodniowe istnieją tylko w trybie DEMO.
 */
export async function EmployerOverviewStats({
  locale,
  overview,
  demo,
  className,
}: {
  locale: string;
  overview: EmployerOverviewLoad;
  /** Tryb bez bazy (dane demonstracyjne) — tylko wtedy podpisy z deltami. */
  demo: boolean;
  className?: string;
}) {
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  if (overview.status === 'error') {
    return (
      <EmployerStatsError className={className} message={td('employerOverviewLoadError')} retryLabel={tc('retry')} />
    );
  }

  const o = overview.overview;
  const recruiterOnly = o.recruiterAccess ? undefined : td('statRecruiterOnly');
  const matchedReason = !o.recruiterAccess
    ? td('statRecruiterOnly')
    : o.companyVerified
      ? undefined
      : td('statAfterVerification');

  return (
    <PanelStats
      className={className}
      noDataLabel={td('funnelNoData')}
      items={[
        {
          label: td('activeOffers'),
          value: o.activeOffersCount,
          sub: demo ? td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.activeOffers }) : undefined,
        },
        {
          label: td('newApplications'),
          value: o.newApplicationsCount,
          sub: demo ? td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.newApplications }) : recruiterOnly,
        },
        {
          label: td('matchedCandidates'),
          value: o.matchedCandidatesCount,
          sub: demo ? td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.matched }) : matchedReason,
        },
        {
          label: td('messagesToAnswer'),
          value: o.messagesToAnswerCount,
          sub: demo ? td('urgent', { count: DEMO_OVERVIEW_DELTAS.urgent }) : recruiterOnly,
        },
      ]}
    />
  );
}
