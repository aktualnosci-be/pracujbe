import * as React from 'react';
import { ArrowRight, Clock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { GuideCategory, GuideListEntry } from '@/lib/guides/guides';

/**
 * GuideCard — karta poradnika na liście `/poradniki`.
 *
 * Pokazuje: etykietę kategorii, tytuł (rozciągnięty, klikalny link do artykułu),
 * zajawkę (`excerpt`), datę publikacji oraz czas czytania. Cały kafel jest klikalny
 * (stretched link), z pierścieniem focus na całej karcie (`focus-within`).
 * Tytuł i zajawka zawijają/dzielą długie słowa (NL/FR/PL) — bez poziomego przewijania przy 200%.
 *
 * Komponent kliencki wyłącznie po to, by użyć `useFormatter` (data w locale) i `useTranslations`
 * (chrome). `GuideListEntry` jest serializowalny — może być renderowany z komponentu serwerowego.
 */

/** Baza ścieżki artykułu (prefiks języka dokłada next-intl Link). */
const GUIDE_BASE = '/poradniki';

/** Mapowanie kategorii na klucz etykiety w namespace `guides`. */
const CATEGORY_LABEL_KEY: Record<GuideCategory, string> = {
  jobSearch: 'catJobSearch',
  contracts: 'catContracts',
  housing: 'catHousing',
  admin: 'catAdmin',
  driving: 'catDriving',
  safety: 'catSafety',
};

export interface GuideCardProps {
  guide: GuideListEntry;
  className?: string;
}

export function GuideCard({ guide, className }: GuideCardProps): React.JSX.Element {
  const t = useTranslations('guides');
  const format = useFormatter();

  const publishedDate = new Date(guide.publishedAt);

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:bg-soft focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-dark">
          {t(CATEGORY_LABEL_KEY[guide.category])}
        </span>
      </div>

      <h2 className="mt-3 break-words text-lg font-semibold leading-snug text-foreground hyphens-auto">
        <Link
          href={`${GUIDE_BASE}/${guide.slug}`}
          className="after:absolute after:inset-0 after:content-[''] focus-visible:underline focus-visible:outline-none"
        >
          {guide.title}
        </Link>
      </h2>

      <p className="mt-2 flex-1 break-words text-sm text-muted-foreground hyphens-auto">{guide.excerpt}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <time dateTime={guide.publishedAt}>
            {format.dateTime(publishedDate, { dateStyle: 'long' })}
          </time>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {t('readingTime', { minutes: guide.readingMinutes })}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-accent">
          {t('read')}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </article>
  );
}
