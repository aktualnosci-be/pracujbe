import { ArrowRight, MapPin } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { StatValue } from '@/components/dashboard/StatValue';
import type { CompanyJobsLoad } from '@/lib/data/employer';
import {
  BTN_SECONDARY,
  EMPTY,
  PANEL,
  PANEL_H2,
  SECTION_HEAD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

interface Labels {
  title: string;
  seeAll: string;
  empty: string;
  loadError: string;
  loadErrorHint: string;
  retry: string;
  newApplications: string;
  matched: string;
  /** „brak danych” — liczniki `null` dla roli bez uprawnień rekrutera. */
  noData: string;
}

/**
 * Podgląd read-only: awaria odczytu nigdy nie udaje pustego konta firmy.
 * Wygląd: `.panel` „Twoje oferty pracy” z prototypu; zamiast tabeli prototypu zostają karty
 * paszportowe (decyzja #171 — jeden układ na każdą szerokość), w kształcie `.p-job`
 * (ramka, promień 20 px, padding 23/23/19 px).
 */
export function EmployerOffersPreview({
  result,
  locale,
  labels,
}: {
  result: CompanyJobsLoad;
  locale: string;
  labels: Labels;
}) {
  return (
    <section className={PANEL}>
      <div className={SECTION_HEAD}>
        <h2 className={PANEL_H2}>{labels.title}</h2>
        <Link href="/employer/oferty" className={TEXT_LINK}>
          {labels.seeAll}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {result.status === 'error' ? (
        <div role="alert" className="rounded-[16px] border border-error/30 bg-card px-[23px] py-5">
          <h3 className="text-[15px] font-[650] text-foreground">{labels.loadError}</h3>
          <p className="my-1.5 text-[13px] text-muted-foreground">{labels.loadErrorHint}</p>
          <a href={`/${locale}/employer`} className={cn(BTN_SECONDARY, 'mt-3')}>
            {labels.retry}
          </a>
        </div>
      ) : result.jobs.length === 0 ? (
        <p className={EMPTY}>
          {labels.empty}
        </p>
      ) : (
        <ul className="grid min-w-0 gap-[18px] xl:grid-cols-2" aria-label={labels.title}>
          {result.jobs.map((offer) => (
            <li key={offer.id} className="min-w-0">
              <article className="flex h-full min-w-0 flex-col rounded-[20px] border border-border bg-card px-[23px] pb-[19px] pt-[23px] transition-colors hover:border-input max-[600px]:rounded-[18px] max-[600px]:p-[21px]">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 break-words text-[19px] font-bold leading-[1.35] tracking-[-0.018em] text-foreground">
                    {offer.title}
                  </h3>
                  <StatusPill status={offer.status} />
                </div>
                {offer.city ? (
                  <p className="mt-3 flex min-w-0 items-center gap-2 break-words text-[13px] leading-[1.4] text-muted-foreground">
                    <MapPin className="size-4 shrink-0" aria-hidden="true" />
                    {offer.city}
                  </p>
                ) : null}
                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-[14px]">
                  <div className="min-w-0">
                    <dt className="break-words hyphens-auto text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      {labels.newApplications}
                    </dt>
                    <dd className="mt-1 text-[22px] font-[650] tracking-[-0.035em] tabular-nums text-foreground">
                      <StatValue value={offer.newApplications} noDataLabel={labels.noData} />
                    </dd>
                  </div>
                  <div className="min-w-0 border-l border-border pl-4">
                    <dt className="break-words hyphens-auto text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      {labels.matched}
                    </dt>
                    <dd className="mt-1 text-[22px] font-[650] tracking-[-0.035em] tabular-nums text-foreground">
                      <StatValue value={offer.matched} noDataLabel={labels.noData} />
                    </dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
