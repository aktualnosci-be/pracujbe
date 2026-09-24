import { formatSalaryParts } from '@/lib/salary';

import * as React from 'react';
import { ArrowRight, BadgeCheck } from 'lucide-react';
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
 *
 * Wygląd = kalka `.job-passport` z prototypu (conditions.css + extended.css; klasy `.pp-passport*`
 * w globals.css): jedna ramka, promień 24 px (20 px ≤ 500 px), pola GDZIE / WYNAGRODZENIE /
 * WARUNKI między liniami, okres stawki drobniej pod kwotą, stopka z logotypem i „Poznaj ofertę →”.
 * Bez stawki zostają dwa pola na całą szerokość. Karta nie ma marginesów — siatkę daje lista
 * (`.pp-job-grid`). Stany aplikacji spoza prototypu (demo, nowa, weryfikacja, data) są w wierszu
 * nazwy firmy.
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

  const salary = formatSalaryParts(job, locale, {
    from: value => t('passport.salaryFrom', { value }),
    to: value => t('passport.salaryTo', { value }),
    period: period => t(`passport.salaryPeriods.${period}`),
  });
  const highlights = job.highlights.slice(0, 2);
  const relative = formatPublishedRelative(job.publishedAt, locale);
  const withMatch = showMatch === true && typeof matchScore === 'number';
  const showRegion = job.region.length > 0 && job.region !== job.city;
  // Fikcyjna firma demo nie dostaje odznaki weryfikacji (#297).
  const verified = job.companyVerified && !job.isDemo;

  return (
    <article className={cn('pp-passport', className)}>
      <header>
        <p className="pp-passport-category">{tCategory(job.category)}</p>
        <PublicSaveJobButton jobId={job.id} iconOnly plain />
      </header>

      <h3>
        <Link
          href={`${JOB_DETAIL_BASE}/${job.slug}`}
          className="after:absolute after:inset-0 after:rounded-[24px] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 max-[500px]:after:rounded-[20px]"
        >
          {job.title}
        </Link>
      </h3>
      {/* Wiersz firmy; stany spoza prototypu (oznaczenie demo — Invariant #12, nowa oferta,
          weryfikacja, data) w tym samym wierszu, żeby karta zachowała wysokość z prototypu. */}
      <p className="pp-passport-company">
        <span>{job.companyName}</span>
        {job.isDemo ? (
          <span className="pp-passport-tag rounded-full border border-warning/40 bg-warning/10 px-2 font-medium text-warning-text">
            {t('demoBadge')}
          </span>
        ) : null}
        {job.isNew ? (
          <span className="pp-passport-tag rounded-full bg-accent/10 px-2 font-medium text-accent-dark">
            {t('newBadge')}
          </span>
        ) : null}
        {verified ? (
          <span className="pp-passport-tag text-success-text">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            {tJob('verified')}
          </span>
        ) : null}
        {relative ? (
          <time
            className="pp-passport-tag"
            dateTime={job.publishedAt}
            title={format.dateTime(new Date(job.publishedAt), { dateStyle: 'long', timeZone: PUBLISHED_DATE_TIME_ZONE })}
          >
            {relative}
          </time>
        ) : null}
      </p>

      <dl className={cn('pp-passport-data', salary === null && 'pp-without-salary')}>
        <div>
          <dt>{t('passport.location')}</dt>
          <dd>
            {job.city}
            {showRegion ? <small>{job.region}</small> : null}
          </dd>
        </div>
        {salary !== null ? (
          <div>
            <dt>{t('passport.salary')}</dt>
            <dd>
              {salary.amount}
              {salary.period ? <>{' '}<small>{salary.period}</small></> : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t('passport.conditions')}</dt>
          <dd>
            {tContract(job.contractType)}
            {highlights.length > 0 ? <small>{highlights.join(' · ')}</small> : null}
          </dd>
        </div>
      </dl>

      {withMatch ? (
        <div className="mt-4 max-w-xs">
          <p className="mb-2 text-sm text-muted-foreground">{t('matchLabel')}</p>
          <MatchBar value={matchScore as number} showLabel />
        </div>
      ) : null}
      {/* Stopka jak `.job-passport > footer`: logotyp tekstowy i „Poznaj ofertę →”. Oba są
          dekoracyjne — link tytułu obejmuje całą kartę, więc czytnik ogłasza tylko tytuł. */}
      <footer>
        <span className="pp-passport-brand" aria-hidden="true">
          pracuj<span className="pp-passport-dot">.be</span>
        </span>
        <span className="pp-passport-cta" aria-hidden="true">
          {t('passport.viewOffer')}
          <ArrowRight strokeWidth={1.5} />
        </span>
      </footer>
    </article>
  );
}
