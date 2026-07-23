'use client';

import * as React from 'react';
import { Bookmark, BookmarkCheck, MapPin } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { JobListItem } from '@/lib/jobs';

/**
 * JobCard — lekki wiersz oferty pracy (NIE ciężka karta).
 *
 * Pokazuje: tytuł (link do szczegółów), nazwę firmy (+ badge „zweryfikowana"),
 * miasto, typ umowy, wynagrodzenie (jeśli podane), względną datę publikacji,
 * do 3 wyróżnień oraz przycisk zapisu (ikona). Badge „new" dla świeżych ofert.
 *
 * Komponent kliencki — przycisk zapisu i formatowanie względnej daty wymagają
 * interakcji/hooków. Dane wejściowe (JobListItem) są w pełni serializowalne,
 * więc może być renderowany z komponentów serwerowych.
 */

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
      maximumFractionDigits: 0,
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
  className?: string;
}

export function JobCard({ job, className }: JobCardProps): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslations('jobs');
  const tContract = useTranslations('contractTypes');
  const tJob = useTranslations('job');

  const [saved, setSaved] = React.useState(false);

  const salary = formatSalary(job, locale);
  const highlights = job.highlights.slice(0, 3);
  const relative = formatRelative(job.publishedAt, locale);
  const SaveIcon = saved ? BookmarkCheck : Bookmark;

  return (
    <article
      className={cn(
        'group relative flex flex-col gap-3 p-4 transition-colors hover:bg-soft sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-snug text-foreground">
            {/* Rozciągnięty link — cały wiersz jest klikalny, poza przyciskiem zapisu. */}
            <Link
              href={`${JOB_DETAIL_BASE}/${job.slug}`}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:underline"
            >
              {job.title}
            </Link>
          </h3>
          {job.isNew ? (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {t('newBadge')}
            </span>
          ) : null}
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{job.companyName}</span>
          {job.companyVerified ? (
            <span
              className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
              title={tJob('verified')}
            >
              {tJob('verified')}
            </span>
          ) : null}
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {job.city}
          </span>
          <span aria-hidden="true">·</span>
          <span>{tContract(job.contractType)}</span>
          {relative ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={job.publishedAt} suppressHydrationWarning>
                {relative}
              </time>
            </>
          ) : null}
        </p>

        {highlights.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {highlights.map((highlight) => (
              <li
                key={highlight}
                className="rounded-full bg-soft px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border"
              >
                {highlight}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:text-right">
        {salary ? (
          <p className="text-sm font-semibold text-foreground">
            {salary}
            <span className="block text-xs font-normal text-muted-foreground">
              {t('salary')}
            </span>
          </p>
        ) : (
          <span className="text-sm text-muted-foreground">{tJob('salaryNotProvided')}</span>
        )}

        {/* z-10, aby przycisk był nad rozciągniętym linkiem tytułu. */}
        <button
          type="button"
          onClick={() => setSaved((value) => !value)}
          aria-pressed={saved}
          aria-label={saved ? t('saved') : t('save')}
          title={saved ? t('saved') : t('save')}
          className={cn(
            'relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            saved ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <SaveIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
