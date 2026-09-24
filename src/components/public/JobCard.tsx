import { formatSalaryRange } from '@/lib/salary';

import * as React from 'react';
import { ArrowUpRight, BadgeCheck } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { MatchBar } from '@/components/ui/match-bar';
import { PublicSaveJobButton } from './PublicSavedJobs';
import type { JobListItem } from '@/lib/jobs';
import { formatPublishedRelative, PUBLISHED_DATE_TIME_ZONE } from '@/lib/relative-date';

/**
 * Paszport oferty: lokalizacja, opcjonalna stawka i warunki z rzeczywistych danych.
 *
 * Komponent serwerowy (#391): karta nie ma stanu ani handlerów, więc do przeglądarki nie
 * trafia cały `JobListItem` (payload RSC), a jedyną wyspą kliencką jest przycisk zapisu,
 * który dostaje samo `jobId`. Tłumaczenia z `next-intl/server`, nie z `next-intl`: import
 * głównego pakietu w komponencie serwerowym rejestruje `NextIntlClientProvider` jako
 * referencję kliencką strony, a Next łączy te referencje po ścieżce (z pominięciem grup
 * tras), więc inne strony dociągałyby wtedy chunki strony głównej i listy. Względna data liczy
 * się raz, na serwerze, z dokładnością do dnia kalendarzowego (`formatPublishedRelative`,
 * zgodne z ISR); pełna data jest w `title`, więc HTML z cache nie wprowadza w błąd.
 */

/** Ścieżka szczegółów oferty (prefiks języka dokłada next-intl Link). */
const JOB_DETAIL_BASE = '/oferty-pracy';

export interface JobCardProps {
  job: JobListItem;
  showMatch?: boolean;
  matchScore?: number;
  className?: string;
}

export async function JobCard({
  job,
  showMatch,
  matchScore,
  className,
}: JobCardProps): Promise<React.JSX.Element> {
  const [locale, t, tContract, tJob, tCategory, format] = await Promise.all([
    getLocale(),
    getTranslations('jobs'),
    getTranslations('contractTypes'),
    getTranslations('job'),
    getTranslations('categories'),
    getFormatter(),
  ]);

  const salary = formatSalaryRange(job, locale, {
    from: value => t('passport.salaryFrom', { value }),
    to: value => t('passport.salaryTo', { value }),
    period: period => t(`passport.salaryPeriods.${period}`),
  });
  const highlights = job.highlights.slice(0, 2);
  const relative = formatPublishedRelative(job.publishedAt, locale);
  const withMatch = showMatch === true && typeof matchScore === 'number';
  const showRegion = job.region.length > 0 && job.region !== job.city;

  return (
    <article
      className={cn(
        'relative min-w-0 rounded-3xl border border-border bg-card p-5 transition-colors hover:border-muted-foreground sm:p-6',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          {tCategory(job.category)}
        </p>
        <PublicSaveJobButton jobId={job.id} iconOnly />
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words text-2xl font-bold leading-tight tracking-tight text-foreground">
          <Link
            href={`${JOB_DETAIL_BASE}/${job.slug}`}
            className="after:absolute after:inset-0 after:rounded-3xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2"
          >
            {job.title}
          </Link>
        </h3>
        {job.isDemo ? (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-text">
            {t('demoBadge')}
          </span>
        ) : null}
        {job.isNew ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-dark">
            {t('newBadge')}
          </span>
        ) : null}
      </div>
      <p className="mb-6 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{job.companyName}</span>
        {/* Fikcyjna firma demo nie dostaje odznaki weryfikacji (#297). */}
        {job.companyVerified && !job.isDemo ? (
          <span className="inline-flex items-center gap-1 text-success-text">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            {tJob('verified')}
          </span>
        ) : null}
      </p>

      <dl className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-5 border-y border-border py-5',
        salary !== null && 'sm:grid-cols-3',
      )}>
        <div className="min-w-0">
          <dt className="mb-2 break-words hyphens-auto text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('passport.location')}</dt>
          <dd className="break-words text-base font-semibold text-foreground">
            {job.city}
            {showRegion ? <span className="mt-1 block text-sm font-normal text-muted-foreground">{job.region}</span> : null}
          </dd>
        </div>
        {salary !== null ? (
          <div className="min-w-0 border-l border-border pl-4">
            <dt className="mb-2 break-words hyphens-auto text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('passport.salary')}</dt>
            <dd className="break-words text-base font-semibold text-foreground">{salary}</dd>
          </div>
        ) : null}
        <div className={cn(
          'min-w-0',
          salary !== null
            ? 'col-span-2 border-t border-border pt-4 sm:col-span-1 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0'
            : 'border-l border-border pl-4',
        )}>
          <dt className="mb-2 break-words hyphens-auto text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('passport.conditions')}</dt>
          <dd className="break-words text-base font-semibold text-foreground">
            {tContract(job.contractType)}
            {highlights.length > 0 ? <span className="mt-1 block text-sm font-normal text-muted-foreground">{highlights.join(' · ')}</span> : null}
          </dd>
        </div>
      </dl>

      {withMatch ? (
        <div className="mt-4 max-w-xs">
          <p className="mb-2 text-sm text-muted-foreground">{t('matchLabel')}</p>
          <MatchBar value={matchScore as number} showLabel />
        </div>
      ) : null}
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {relative ? (
          <time
            dateTime={job.publishedAt}
            title={format.dateTime(new Date(job.publishedAt), { dateStyle: 'long', timeZone: PUBLISHED_DATE_TIME_ZONE })}
            className="text-xs text-muted-foreground"
          >
            {relative}
          </time>
        ) : null}
        <span className="ml-auto inline-flex min-h-12 items-center gap-3 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" aria-hidden="true">
          {t('passport.viewOffer')}
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </footer>
    </article>
  );
}
