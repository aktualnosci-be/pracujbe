import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import type { TopListingJobsLoad } from '@/lib/data/employer';
import {
  PANEL,
  PANEL_H2,
  PANEL_P,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * „Statystyki ogłoszeń” na pulpicie pracodawcy w trybie ogłoszeniowym (decyzja produktowa:
 * portal ogłoszeniowy) — zwarty skrót w miejscu dawnych „Top dopasowani”: do trzech najczęściej
 * oglądanych ofert z ostatnich 30 dni z liczbą wyświetleń i kliknięć „Aplikuj u pracodawcy”
 * (lejek ofert, bez tabel procesu) i odnośnik do pełnych statystyk. Tryb rekrutacyjny
 * (`status: 'disabled'`): komponent nic nie renderuje. Brak uprawnień, błąd odczytu i brak ruchu
 * to trzy różne stany — żaden nie udaje zer.
 */
export async function EmployerListingStats({
  locale,
  top,
}: {
  locale: string;
  top: TopListingJobsLoad;
}) {
  if (top.status === 'disabled') return null;
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  const tf = await getTranslations({ locale, namespace: 'jobFunnel' });
  const nf = new Intl.NumberFormat(locale);

  return (
    <section className={PANEL} data-testid="employer-listing-stats-link">
      <div className={cn(SECTION_HEAD, 'mb-1.5')}>
        <h2 className={PANEL_H2}>{td('listingStatsTitle')}</h2>
        <Link href="/employer/statystyki" className={TEXT_LINK}>
          {td('funnelDetails')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <p className={PANEL_P}>{td('listingStatsText')}</p>
      {top.status === 'error' ? (
        <EmployerStatsError className="mt-4 border-0 p-0" message={td('listingTopJobsError')} retryLabel={tc('retry')} />
      ) : top.status === 'denied' ? (
        <p className={'mt-3 text-sm text-muted-foreground'}>{td('listingTopJobsDenied')}</p>
      ) : top.jobs.length === 0 ? (
        <p className={'mt-3 text-sm text-muted-foreground'}>{td('listingTopJobsEmpty')}</p>
      ) : (
        <ul className="mt-2 min-w-0">
          {top.jobs.map((job) => (
            <li key={job.jobId} className={ROW}>
              <div className="min-w-0 flex-1">
                {job.slug ? (
                  <h3 className={ROW_TITLE}>
                    <Link
                      href={`/oferty-pracy/${encodeURIComponent(job.slug)}`}
                      className="break-words hover:text-primary hover:underline"
                    >
                      {job.title}
                    </Link>
                  </h3>
                ) : (
                  <h3 className={ROW_TITLE}>{job.title}</h3>
                )}
                <p className={ROW_META}>
                  {tf('detailViews')}: <span className="font-semibold tabular-nums text-foreground">{nf.format(job.detailViews)}</span>
                </p>
                <p className={ROW_META}>
                  {tf('applyClicks')}: <span className="font-semibold tabular-nums text-foreground">{nf.format(job.applyClicks)}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
