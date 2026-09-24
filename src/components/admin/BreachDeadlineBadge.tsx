import * as React from 'react';
import { useTranslations } from 'next-intl';

import { breachDeadline, type BreachDeadlineState } from '@/lib/admin/breach';
import { cn } from '@/lib/utils';
import { STATUS, STATUS_GOOD } from '@/components/admin/admin-styles';

/**
 * Stan terminu 72 h na zgłoszenie naruszenia do organu (#490), liczonego od STWIERDZENIA
 * naruszenia (`detected_at`), a nie od zakończenia analizy. Liczone przy renderze strony
 * (panel jest `force-dynamic`); tekst, nie tylko kolor.
 */

const WARNING = 'inline-block max-w-full break-words rounded-[8px] bg-warning/10 px-3 py-2 text-xs text-warning-text';
const DANGER = 'inline-block max-w-full break-words rounded-[8px] bg-error/10 px-3 py-2 text-xs font-semibold text-error-text';

export function BreachDeadlineBadge({
  incident,
  now,
  className,
}: {
  incident: {
    kind: string;
    detectedAt: string | null;
    authorityDecision: string;
    authorityNotifiedAt: string | null;
    status: string;
  };
  /** Chwila odniesienia (ms) — jedna na stronę. */
  now: number;
  className?: string;
}): React.JSX.Element | null {
  const t = useTranslations('admin');
  const state: BreachDeadlineState = breachDeadline(incident, now);
  switch (state.state) {
    case 'notApplicable':
      return null;
    case 'notified':
      return (
        <span className={cn(state.late ? WARNING : STATUS_GOOD, className)}>
          {state.late ? t('breachDeadlineNotifiedLate') : t('breachDeadlineNotified')}
        </span>
      );
    case 'running':
      return (
        <span className={cn(state.hoursLeft < 24 ? WARNING : STATUS, className)}>
          {t('breachDeadlineRunning', { hours: state.hoursLeft })}
        </span>
      );
    case 'overdue':
      return (
        <span className={cn(DANGER, className)}>{t('breachDeadlineOverdue', { hours: state.hoursOver })}</span>
      );
  }
}
