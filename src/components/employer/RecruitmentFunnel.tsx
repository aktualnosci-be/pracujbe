import * as React from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * RecruitmentFunnel — lejek rekrutacyjny panelu pracodawcy (makieta 05).
 *
 * Cztery etapy (Wyświetlenia ofert → Aplikacje → Rozmowy → Zatrudnieni) z trzema
 * współczynnikami konwersji między nimi. „Prosty lejek, bez ciężkich wykresów":
 *  - desktop (lg+): etapy w poziomie, konwersje jako pigułki między blokami (strzałka →),
 *  - mobile: etapy w pionie, konwersje między nimi (strzałka ↓).
 *
 * Komponent samowystarczalny: etykiety etapów i chrome (tytuł/okres/„Zobacz szczegóły")
 * z i18n `dashboard.*`, liczby formatowane wg locale (spacje w tysiącach). Wartości z
 * `getFunnelStats` (ostatnie 30 dni, #302).
 *
 * Etap bez danych (`null`, np. wyświetlenia bez mechanizmu zliczania) pokazuje „brak danych",
 * a konwersje z nim sąsiadujące są pomijane — nigdy fałszywe 0 ani 0% (#302).
 *
 * Przy 200% tekstu (#318) etapy zawijają się do kolejnych wierszy zamiast wychodzić poza
 * kontener (brak sztywnych szerokości w rem, `min-w-0` + `break-words`).
 */

export interface RecruitmentFunnelProps {
  /** `null` = brak danych (nie zero). */
  views: number | null;
  applications: number;
  interviews: number;
  hired: number;
  className?: string;
}

/** Konwersja w % (1 miejsce po przecinku); `null`, gdy brak danych lub mianownik 0. */
export function conversionPct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function RecruitmentFunnel({
  views,
  applications,
  interviews,
  hired,
  className,
}: RecruitmentFunnelProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const format = useFormatter();

  const conversions = [
    conversionPct(applications, views),
    conversionPct(interviews, applications),
    conversionPct(hired, interviews),
  ];

  const stages: { label: string; value: number | null }[] = [
    { label: td('funnelViews'), value: views },
    { label: td('funnelApplications'), value: applications },
    { label: td('funnelInterviews'), value: interviews },
    { label: td('funnelHired'), value: hired },
  ];

  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-border p-4 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">
          {td('funnelTitle')}{' '}
          <span className="text-sm font-normal text-muted-foreground">({td('funnelPeriod')})</span>
        </h2>
        <Link
          href="/employer/statystyki"
          className="ml-auto inline-flex min-h-12 shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          {td('funnelDetails')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="p-4 sm:p-5">
        <ol className="flex flex-col lg:flex-row lg:flex-wrap lg:items-stretch lg:gap-y-2">
          {stages.map((stage, index) => {
            const conversion = conversions[index];
            return (
              <React.Fragment key={stage.label}>
                <li className="min-w-0 flex-1 break-words rounded-md bg-soft px-4 py-3 text-center lg:basis-32">
                  {stage.value === null ? (
                    <p className="text-base font-semibold leading-tight text-muted-foreground">
                      {td('funnelNoData')}
                    </p>
                  ) : (
                    <p className="text-2xl font-bold leading-tight tabular-nums text-foreground">
                      {format.number(stage.value)}
                    </p>
                  )}
                  <p className="mt-0.5 text-sm text-muted-foreground">{stage.label}</p>
                </li>
                {index < stages.length - 1 ? (
                  <li
                    className="flex min-w-0 items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground lg:flex-col lg:gap-1 lg:px-2 lg:py-0"
                    aria-hidden={conversion == null ? true : undefined}
                  >
                    <ArrowDown className="size-3.5 shrink-0 lg:hidden" aria-hidden="true" />
                    <ArrowRight className="hidden size-3.5 shrink-0 lg:block" aria-hidden="true" />
                    {conversion == null ? null : (
                      <span className="break-words text-center">
                        {td('conversion', { value: conversion })}
                      </span>
                    )}
                  </li>
                ) : null}
              </React.Fragment>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
