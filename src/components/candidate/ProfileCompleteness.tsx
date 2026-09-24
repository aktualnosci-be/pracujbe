import * as React from 'react';

import { cn } from '@/lib/utils';
import { PANEL_P, PROGRESS, PROGRESS_FILL } from '@/components/dashboard/panel-styles';

/**
 * ProfileCompleteness — wskaźnik kompletności profilu kandydata (%).
 *
 * Wygląd: panel „Twój profil · 80%” z prototypu „04 Ludzie i praca” — procent i tytuł,
 * opis `.panel p` oraz pasek `.progress` (6 px, wypełnienie w kolorze marki).
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
  /** Dawna średnica pierścienia — ignorowana (zgodność wywołań). */
  size?: number;
  className?: string;
}

export function ProfileCompleteness({
  value,
  title,
  hint,
  className,
}: ProfileCompletenessProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={cn('min-w-0', className)}>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-[22px] font-bold tabular-nums tracking-[-0.035em] text-foreground">
          {pct}%
        </span>
        {title ? <span className="break-words text-[13px] font-semibold text-foreground">{title}</span> : null}
      </p>
      <p className={cn(PANEL_P, 'mt-1 break-words text-[13px]')}>{hint}</p>
      <div
        className={PROGRESS}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}%`}
      >
        <span className={PROGRESS_FILL} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
