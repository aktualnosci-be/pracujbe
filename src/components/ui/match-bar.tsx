import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * MatchBar — poziomy pasek dopasowania kandydat↔oferta (0–100%).
 *
 * Zielony wypełniony pasek (success) na jasnej ścieżce (border). Opcjonalna etykieta
 * procentowa (liczba, nie wymaga tłumaczenia). Dostępny: role="progressbar" + aria.
 * Komponent czysto prezentacyjny (serwerowy) — może być renderowany wszędzie.
 */

export interface MatchBarProps {
  value: number;
  showLabel?: boolean;
  className?: string;
}

export function MatchBar({ value, showLabel, className }: MatchBarProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const label = `${pct}%`;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showLabel ? (
        <span className="w-10 shrink-0 text-sm font-semibold tabular-nums text-success-text">
          {label}
        </span>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
