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
 *
 * Tryb ogłoszeniowy (#1147): aktywne oferty, wyświetlenia i kliknięcia „Aplikuj u pracodawcy”
 * z ostatnich 30 dni — bez kafelków zgłoszeń, dopasowanych i wiadomości.
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
  const tf = await getTranslations({ locale, namespace: 'jobFunnel' });

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

  // #1147: tryb ogłoszeniowy — loader zwraca statystyki ogłoszeń zamiast liczników procesu
  // (zgłoszenia, dopasowani, rozmowy): tych kafelków nie ma wcale, a nie „—”.
  if (o.listingDetailViews !== undefined || o.listingApplyClicks !== undefined) {
    const period = recruiterOnly ?? td('funnelPeriod');
    return (
      <PanelStats
        className={className}
        noDataLabel={td('funnelNoData')}
        items={[
          { label: td('activeOffers'), value: o.activeOffersCount },
          { label: tf('detailViews'), value: o.listingDetailViews ?? null, sub: period },
          { label: tf('applyClicks'), value: o.listingApplyClicks ?? null, sub: period },
        ]}
      />
    );
  }

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
          value: o.newApplicationsCount ?? null,
          sub: demo ? td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.newApplications }) : recruiterOnly,
        },
        // #1133: tryb ogłoszeniowy — loader nie zwraca pola, kafelka nie ma (bez „—”).
        ...(o.matchedCandidatesCount !== undefined
          ? [
              {
                label: td('matchedCandidates'),
                value: o.matchedCandidatesCount,
                sub: demo ? td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.matched }) : matchedReason,
              },
            ]
          : []),
        {
          label: td('messagesToAnswer'),
          value: o.messagesToAnswerCount ?? null,
          sub: demo ? td('urgent', { count: DEMO_OVERVIEW_DELTAS.urgent }) : recruiterOnly,
        },
      ]}
    />
  );
}
