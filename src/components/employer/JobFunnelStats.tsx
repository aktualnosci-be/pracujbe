import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { createAppDateFormatter } from '@/lib/datetime';
import type { JobFunnelItem, JobFunnelMetrics } from '@/lib/data/employer';
import { FUNNEL_RANGE_OPTIONS, type FunnelDateRange } from '@/lib/job-funnel/range';
import { cn } from '@/lib/utils';

/**
 * Lejek ofert panelu pracodawcy (#99): pojawienia w wynikach → wyświetlenia → rozpoczęte
 * aplikowanie → wysłane aplikacje. Pokazuje zakres dat (dni Europe/Brussels), definicję każdej
 * metryki i rozbicie per oferta (karty zawijane przy 200% tekstu — bez poziomego przewijania, #318). Dane z serwerowego agregatu bez śledzenia osób (0089).
 */

const METRICS = [
  { key: 'searchAppearances', label: 'searchAppearances', definition: 'searchAppearancesDefinition' },
  { key: 'detailViews', label: 'detailViews', definition: 'detailViewsDefinition' },
  { key: 'applyStarted', label: 'applyStarted', definition: 'applyStartedDefinition' },
  { key: 'applicationsSubmitted', label: 'applicationsSubmitted', definition: 'applicationsSubmittedDefinition' },
] as const satisfies ReadonlyArray<{ key: keyof JobFunnelMetrics; label: string; definition: string }>;

export function JobFunnelRangePicker({ range }: { range: FunnelDateRange }): React.JSX.Element {
  const t = useTranslations('jobFunnel');
  return (
    <nav aria-label={t('rangeLabel')} className="flex flex-wrap gap-2">
      {FUNNEL_RANGE_OPTIONS.map((days) => {
        const current = days === range.days;
        return (
          <Link
            key={days}
            href={{ pathname: '/employer/statystyki', query: { dni: String(days) } }}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-12 items-center rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              current
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-foreground hover:bg-soft',
            )}
          >
            {t('rangeDays', { count: days })}
          </Link>
        );
      })}
    </nav>
  );
}

export function JobFunnelStats({
  range,
  totals,
  jobs,
  locale,
}: {
  range: FunnelDateRange;
  totals: JobFunnelMetrics;
  jobs: readonly JobFunnelItem[];
  locale: string;
}): React.JSX.Element {
  const t = useTranslations('jobFunnel');
  const format = useFormatter();
  const formatDay = createAppDateFormatter(locale);
  const day = (ymd: string) => formatDay(`${ymd}T12:00:00Z`);

  return (
    <section aria-labelledby="job-funnel-title" className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 id="job-funnel-title" className="text-base font-semibold text-foreground">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="job-funnel-range">
          {t('range', { from: day(range.from), to: day(range.to) })}
        </p>
      </div>

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
        {METRICS.map((metric) => (
          <div key={metric.key} className="min-w-0 rounded-lg border border-border bg-background p-3">
            <dt className="break-words text-sm font-medium text-muted-foreground">{t(metric.label)}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {format.number(totals[metric.key])}
            </dd>
          </div>
        ))}
      </dl>

      <details className="rounded-lg border border-border bg-background p-3">
        <summary className="min-h-12 cursor-pointer content-center text-sm font-semibold text-foreground">
          {t('definitionsTitle')}
        </summary>
        <dl className="mt-2 space-y-2 text-sm">
          {METRICS.map((metric) => (
            <div key={metric.key}>
              <dt className="font-semibold text-foreground">{t(metric.label)}</dt>
              <dd className="text-muted-foreground">{t(metric.definition)}</dd>
            </div>
          ))}
          <div>
            <dt className="font-semibold text-foreground">{t('privacyTitle')}</dt>
            <dd className="text-muted-foreground">{t('privacyNote')}</dd>
          </div>
        </dl>
      </details>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul aria-label={t('tableCaption')} className="space-y-3">
          {jobs.map((job) => (
            <li key={job.jobId} className="min-w-0 rounded-lg border border-border bg-background p-3">
              <h3 className="break-words text-sm font-semibold text-foreground">{job.title || t('untitled')}</h3>
              <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-x-4 gap-y-2">
                {METRICS.map((metric) => (
                  <div key={metric.key} className="min-w-0">
                    <dt className="break-words text-xs text-muted-foreground">{t(metric.label)}</dt>
                    <dd className="text-base font-semibold tabular-nums text-foreground">
                      {format.number(job[metric.key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
