'use client';

import * as React from 'react';
import { BadgeCheck, Bookmark, BookmarkCheck, MapPin } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { MatchBar } from '@/components/ui/match-bar';
import type { JobListItem } from '@/lib/jobs';

/**
 * JobCard — lekki WIERSZ oferty pracy wg makiet (02-jobs-list / 01-home), NIE ciężka karta.
 *
 * Pokazuje: logo (inicjały firmy), tytuł (link do szczegółów), firmę + „✓ zweryfikowany",
 * meta-chipy (miasto, region, typ umowy, wyróżnienia), wynagrodzenie LUB pasek dopasowania
 * (dla panelu kandydata: `showMatch` + `matchScore`), względną datę publikacji oraz zapis.
 * Hover: jasne tło (`bg-soft`) + lewy pasek w kolorze akcentu. Cały wiersz klikalny
 * (rozciągnięty link tytułu), przycisk zapisu ponad linkiem (`z-10`).
 *
 * Komponent kliencki (stan zapisu + względna data). `JobListItem` jest serializowalny,
 * więc może być renderowany z komponentów serwerowych.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Ścieżka szczegółów oferty (prefiks języka dokłada next-intl Link). */
const JOB_DETAIL_BASE = '/oferty-pracy';

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const letters = parts.map((part) => part.charAt(0).toUpperCase()).join('');
  return letters || '•';
}

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

  const [saved, setSaved] = React.useState(false);

  const salary = formatSalary(job, locale);
  const highlights = job.highlights.slice(0, 2);
  const relative = formatRelative(job.publishedAt, locale);
  const SaveIcon = saved ? BookmarkCheck : Bookmark;
  const withMatch = showMatch === true && typeof matchScore === 'number';
  const showRegion = job.region.length > 0 && job.region !== job.city;

  return (
    <article
      className={cn(
        'group relative flex gap-3 rounded-lg p-4 transition-colors hover:bg-soft sm:gap-4',
        'before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent before:opacity-0 before:transition-opacity group-hover:before:opacity-100',
        className,
      )}
    >
      {/* Logo firmy — placeholder z inicjałami (brak URL logo w modelu). */}
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
        aria-hidden="true"
      >
        {initials(job.companyName)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-snug text-foreground">
            {/* Rozciągnięty link — cały wiersz klikalny (poza przyciskiem zapisu). */}
            <Link
              href={`${JOB_DETAIL_BASE}/${job.slug}`}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:underline focus-visible:outline-none"
            >
              {job.title}
            </Link>
          </h3>
          {job.isNew ? (
            <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
              {t('newBadge')}
            </span>
          ) : null}
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{job.companyName}</span>
          {job.companyVerified ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {tJob('verified')}
            </span>
          ) : null}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {job.city}
          </span>
          {showRegion ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {job.region}
            </span>
          ) : null}
          <span className="rounded-full bg-soft px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border">
            {tContract(job.contractType)}
          </span>
          {highlights.map((highlight) => (
            <span
              key={highlight}
              className="rounded-full bg-soft px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border"
            >
              {highlight}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          {withMatch ? (
            <div className="min-w-0 max-w-[12rem] flex-1">
              <MatchBar value={matchScore as number} showLabel />
            </div>
          ) : salary ? (
            <p className="text-sm font-semibold text-foreground">
              {salary}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {t('salary')}
              </span>
            </p>
          ) : (
            <span className="text-sm text-muted-foreground">{tJob('salaryNotProvided')}</span>
          )}

          <div className="flex shrink-0 items-center gap-3">
            {relative ? (
              <time
                dateTime={job.publishedAt}
                suppressHydrationWarning
                className="text-xs text-muted-foreground"
              >
                {relative}
              </time>
            ) : null}
            {/* z-10 — ponad rozciągniętym linkiem tytułu. */}
            <button
              type="button"
              onClick={() => setSaved((value) => !value)}
              aria-pressed={saved}
              aria-label={saved ? t('saved') : t('save')}
              title={saved ? t('saved') : t('save')}
              className={cn(
                'relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                saved ? 'text-accent' : 'text-muted-foreground',
              )}
            >
              <SaveIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
