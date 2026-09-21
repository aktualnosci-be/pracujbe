'use client';

import * as React from 'react';
import { ArrowUpRight, BadgeCheck, Bookmark, BookmarkCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { MatchBar } from '@/components/ui/match-bar';
import type { JobListItem } from '@/lib/jobs';

/** Paszport oferty: lokalizacja, opcjonalna stawka i warunki z rzeczywistych danych. */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Ścieżka szczegółów oferty (prefiks języka dokłada next-intl Link). */
const JOB_DETAIL_BASE = '/oferty-pracy';

function formatRelative(iso: string, locale: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = then - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const days = Math.round(diffMs / DAY_MS);
  if (Math.abs(days) < 1) {
    const hours = Math.round(diffMs / HOUR_MS);
    return Math.abs(hours) < 1 ? rtf.format(0, 'day') : rtf.format(hours, 'hour');
  }
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  const weeks = Math.round(days / 7);
  if (Math.abs(weeks) < 5) return rtf.format(weeks, 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

function formatSalary(job: JobListItem, locale: string): string | null {
  const currency = job.currency || 'EUR';
  const fmt = (value: number): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value);

  if (job.salaryMin !== undefined && job.salaryMax !== undefined) {
    return `${fmt(job.salaryMin)} – ${fmt(job.salaryMax)}`;
  }
  if (job.salaryMin !== undefined) return fmt(job.salaryMin);
  if (job.salaryMax !== undefined) return fmt(job.salaryMax);
  return null;
}

export interface JobCardProps {
  job: JobListItem;
  showMatch?: boolean;
  matchScore?: number;
  className?: string;
}

export function JobCard({
  job,
  showMatch,
  matchScore,
  className,
}: JobCardProps): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslations('jobs');
  const tContract = useTranslations('contractTypes');
  const tJob = useTranslations('job');
  const tCategory = useTranslations('categories');

  const [saved, setSaved] = React.useState(false);

  const salaryValue = formatSalary(job, locale);
  const salary = salaryValue === null ? null
    : job.salaryMax === undefined ? t('passport.salaryFrom', { value: salaryValue })
    : job.salaryMin === undefined ? t('passport.salaryTo', { value: salaryValue })
    : salaryValue;
  const highlights = job.highlights.slice(0, 2);
  const relative = formatRelative(job.publishedAt, locale);
  const SaveIcon = saved ? BookmarkCheck : Bookmark;
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
        <button
          type="button"
          onClick={() => setSaved((value) => !value)}
          aria-pressed={saved}
          aria-label={saved ? t('saved') : t('save')}
          title={saved ? t('saved') : t('save')}
          className={cn(
            'relative z-10 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            saved ? 'text-accent' : 'text-muted-foreground',
          )}
        >
          <SaveIcon className="h-5 w-5" aria-hidden="true" />
        </button>
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
        {job.isNew ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-dark">
            {t('newBadge')}
          </span>
        ) : null}
      </div>
      <p className="mb-6 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{job.companyName}</span>
        {job.companyVerified ? (
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
          <dt className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('passport.location')}</dt>
          <dd className="break-words text-base font-semibold text-foreground">
            {job.city}
            {showRegion ? <span className="mt-1 block text-sm font-normal text-muted-foreground">{job.region}</span> : null}
          </dd>
        </div>
        {salary !== null ? (
          <div className="min-w-0 border-l border-border pl-4">
            <dt className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('passport.salary')}</dt>
            <dd className="break-words text-base font-semibold text-foreground">{salary}</dd>
          </div>
        ) : null}
        <div className={cn(
          'min-w-0',
          salary !== null
            ? 'col-span-2 border-t border-border pt-4 sm:col-span-1 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0'
            : 'border-l border-border pl-4',
        )}>
          <dt className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('passport.conditions')}</dt>
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
          <time dateTime={job.publishedAt} suppressHydrationWarning className="text-xs text-muted-foreground">
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
