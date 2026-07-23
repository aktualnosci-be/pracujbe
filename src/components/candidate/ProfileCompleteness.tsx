import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * ProfileCompleteness — kołowy wskaźnik kompletności profilu kandydata (%).
 *
 * Odwzorowuje pierścień z makiet 04 (panel: 78%) i 06 (onboarding: 45%): zielony łuk
 * (success) na jasnej ścieżce (border), procent w środku, obok krótki tytuł/opis.
 * Wartość (liczba %) nie wymaga tłumaczenia; `title`/`hint` przekazuje ekran (i18n).
 *
 * Komponent czysto prezentacyjny — bez interakcji ani API serwerowych, więc może być
 * renderowany zarówno w komponentach serwerowych, jak i klienckich (kreator onboardingu).
 */

export interface ProfileCompletenessProps {
  /** Wartość 0–100. */
  value: number;
  /** Krótki nagłówek obok pierścienia (np. „Dobry poziom"). Opcjonalny. */
  title?: string;
  /** Zdanie zachęty pod tytułem. */
  hint: string;
  /** Średnica pierścienia w px (domyślnie 88). */
  size?: number;
  className?: string;
}

export function ProfileCompleteness({
  value,
  title,
  hint,
  size = 88,
  className,
}: ProfileCompletenessProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const stroke = size >= 80 ? 8 : 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);
  const center = size / 2;

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${pct}%`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-border"
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="stroke-success transition-all"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums text-foreground"
          aria-hidden="true"
        >
          {pct}%
        </span>
      </div>

      <div className="min-w-0">
        {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
