import { formatSalaryRange } from '@/lib/salary';

import * as React from 'react';
import { ArrowRight, BadgeCheck } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/Logo';
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
 *
 * Wygląd wg `.job-passport` z prototypu (conditions.css): jedna ramka, promień 20 px, pola
 * GDZIE / WYNAGRODZENIE / WARUNKI między liniami, stopka z logotypem po lewej i czerwonym
 * „Poznaj ofertę →” po prawej. Karta nie ma własnego tła sekcji ani marginesów — siatkę
 * i odstępy daje strona (lista `<ul>`), więc karty nie nachodzą na siebie i nie dublują
 * krawędzi. Data publikacji (brak jej w prototypie) stoi przy nazwie firmy.
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
        'relative flex min-w-0 flex-col rounded-[1.25rem] border border-border bg-card px-5 pb-5 pt-5 transition-colors hover:border-muted-foreground sm:px-[1.625rem] sm:pb-5 sm:pt-[1.375rem]',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          {tCategory(job.category)}
        </p>
        <PublicSaveJobButton jobId={job.id} iconOnly plain />
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words text-[1.4375rem] font-[750] leading-[1.2] tracking-[-0.035em] text-foreground sm:text-2xl">
          <Link
            href={`${JOB_DETAIL_BASE}/${job.slug}`}
            className="after:absolute after:inset-0 after:rounded-[1.25rem] after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2"
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
        {relative ? (
          <>
            <span aria-hidden="true">·</span>
            <time
              dateTime={job.publishedAt}
              title={format.dateTime(new Date(job.publishedAt), { dateStyle: 'long', timeZone: PUBLISHED_DATE_TIME_ZONE })}
            >
              {relative}
            </time>
          </>
        ) : null}
        {/* Fikcyjna firma demo nie dostaje odznaki weryfikacji (#297). */}
        {job.companyVerified && !job.isDemo ? (
          <span className="inline-flex items-center gap-1 text-success-text">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            {tJob('verified')}
          </span>
        ) : null}
      </p>

      <dl className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-5 border-y border-border py-5 sm:py-[1.375rem]',
        salary !== null && 'sm:grid-cols-3',
      )}>
        <div className="min-w-0">
          <dt className="mb-2 break-words hyphens-auto text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{t('passport.location')}</dt>
          <dd className="break-words text-base font-semibold text-foreground">
            {job.city}
            {showRegion ? <span className="mt-1 block text-sm font-normal text-muted-foreground">{job.region}</span> : null}
          </dd>
        </div>
        {salary !== null ? (
          <div className="min-w-0 border-l border-border pl-4">
            <dt className="mb-2 break-words hyphens-auto text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{t('passport.salary')}</dt>
            <dd className="break-words text-base font-semibold text-foreground">{salary}</dd>
          </div>
        ) : null}
        <div className={cn(
          'min-w-0',
          salary !== null
            ? 'col-span-2 border-t border-border pt-4 sm:col-span-1 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0'
            : 'border-l border-border pl-4',
        )}>
          <dt className="mb-2 break-words hyphens-auto text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{t('passport.conditions')}</dt>
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
      {/* `mt-auto`: w siatce karty mają równą wysokość, stopka zawsze na dole. Logotyp jest
          dekoracyjny (nazwa serwisu jest w nagłówku strony), a „Poznaj ofertę” to wizualna
          część linku tytułu rozciągniętego na całą kartę — czytnik ogłasza tylko tytuł. */}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
        <span aria-hidden="true">
          <Logo className="text-sm" />
        </span>
        <span className="ml-auto inline-flex min-h-[2.875rem] items-center gap-3.5 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" aria-hidden="true">
          {t('passport.viewOffer')}
          <ArrowRight className="h-4 w-4" />
        </span>
      </footer>
    </article>
  );
}
