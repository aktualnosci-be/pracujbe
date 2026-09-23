import * as React from 'react';

import { cn } from '@/lib/utils';
import { MatchBar } from '@/components/ui/match-bar';

/**
 * StatCard — kafelek statystyki panelu (np. „Nowe oferty 24", „Kompletność profilu 78%").
 *
 * Układ: etykieta (góra) + ikona w barwionym kwadracie (opcjonalnie, prawy górny róg)
 * + duża wartość + podpis (opcjonalnie) + pasek postępu (opcjonalnie, np. kompletność).
 *
 * `tone` steruje kolorem:
 *  - gdy podano `icon` → koloruje kwadrat ikony (jak w panelu pracodawcy), wartość pozostaje foreground;
 *  - gdy BEZ ikony → koloruje samą wartość (jak w panelu kandydata: „2" czerwone, „78%" akcent).
 * Wszystkie teksty (label/value/sub) są przekazywane już przetłumaczone przez ekran (i18n),
 * dlatego komponent jest czysto prezentacyjny (serwerowy).
 */

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'accent';

const ICON_TONE: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
  accent: 'bg-accent/10 text-accent-dark',
};

const VALUE_TONE: Record<Tone, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  accent: 'text-accent',
};

export interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'accent';
  progress?: number;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
  progress,
}: StatCardProps): React.JSX.Element {
  const valueClass = !icon && tone ? VALUE_TONE[tone] : 'text-foreground';

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
        {icon ? (
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md [&_svg]:h-5 [&_svg]:w-5',
              ICON_TONE[tone ?? 'primary'],
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>

      <p className={cn('mt-2 break-words text-3xl font-bold leading-tight tabular-nums', valueClass)}>
        {value}
      </p>

      {sub ? <p className="mt-1 break-words text-sm text-muted-foreground">{sub}</p> : null}

      {typeof progress === 'number' ? <MatchBar value={progress} className="mt-3" /> : null}
    </div>
  );
}
