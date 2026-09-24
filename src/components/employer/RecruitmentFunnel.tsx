import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  PANEL,
  PANEL_H2,
  PANEL_P,
  PROGRESS,
  PROGRESS_FILL,
  SECTION_HEAD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';

/**
 * RecruitmentFunnel — lejek rekrutacyjny panelu pracodawcy (makieta 05).
 *
 * Cztery etapy (Wyświetlenia ofert → Aplikacje → Rozmowy → Zatrudnieni) z trzema
 * współczynnikami konwersji między nimi. Wygląd: panel „Rekrutacja w liczbach” z prototypu
 * „04 Ludzie i praca” — pasek `.progress` nad każdym etapem i wiersz „<strong>liczba</strong>
 * etykieta”; konwersja z poprzedniego etapu pod wierszem.
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

  // Paski `.progress` względem największej znanej wartości (zwykle wyświetlenia albo aplikacje).
  const known = stages.map((stage) => stage.value).filter((value): value is number => value !== null);
  const max = Math.max(0, ...known);

  return (
    <section className={cn(PANEL, className)}>
      <div className={cn(SECTION_HEAD, 'mb-0')}>
        <h2 className={PANEL_H2}>{td('funnelTitle')}</h2>
        <Link href="/employer/statystyki" className={TEXT_LINK}>
          {td('funnelDetails')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <p className={cn(PANEL_P, 'mt-1.5')}>{td('funnelPeriod')}</p>

      <ol className="min-w-0">
        {stages.map((stage, index) => {
          // Konwersja do etapu z poprzedniego (pierwszy etap jej nie ma).
          const conversion = index > 0 ? conversions[index - 1] : null;
          const width = stage.value === null || max === 0 ? 0 : Math.round((stage.value / max) * 100);
          return (
            <li key={stage.label} className="min-w-0 break-words">
              <div className={PROGRESS} aria-hidden="true">
                <span className={PROGRESS_FILL} style={{ width: `${width}%` }} />
              </div>
              <p className="text-[13px] text-muted-foreground">
                {stage.value === null ? (
                  <strong className="font-semibold text-muted-foreground">{td('funnelNoData')}</strong>
                ) : (
                  <strong className="font-bold tabular-nums text-foreground">
                    {format.number(stage.value)}
                  </strong>
                )}{' '}
                {stage.label}
              </p>
              {conversion == null ? null : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {td('conversion', { value: conversion })}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
