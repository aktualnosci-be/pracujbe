import * as React from 'react';

import { EYEBROW, H1_EXTENDED, P_EXTENDED } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Nagłówek ekranu panelu kandydata — `shell()` z prototypu „04 Ludzie i praca”
 * (`extended.js`): `.eyebrow` („TWOJE MIEJSCE”), `.people .extended h1` (40 px, ≤ 600 px 30 px)
 * i `.dash-intro` w `.extended` (15 px / 1.7). Teksty przychodzą przetłumaczone.
 */
export function CandidatePageHeader({
  eyebrow,
  title,
  intro,
  className,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <header className={cn('min-w-0', className)}>
      <p className={EYEBROW}>{eyebrow}</p>
      <h1 className={H1_EXTENDED}>{title}</h1>
      {intro ? <p className={cn(P_EXTENDED, 'mb-[25px] mt-2 max-w-2xl break-words')}>{intro}</p> : null}
    </header>
  );
}
