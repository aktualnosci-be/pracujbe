'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * AdminConfirmDialog — dialog potwierdzenia decyzji admina (firmy #310, zgłoszenia #422).
 *
 * `role="alertdialog"` + `aria-modal`, fokus startuje na „Anuluj”, Tab zapętlony w dialogu,
 * Escape/„Anuluj” zamyka (rodzic oddaje fokus przyciskowi otwierającemu). W trakcie zapisu
 * przyciski zablokowane (Invariant #11), a Escape nie zamyka. Teksty przekazuje rodzic (i18n).
 */

export type AdminActionTone = 'success' | 'error' | 'warning' | 'neutral';

/** Przycisk akcji na białym tle → warianty `-text` (WCAG AA 4,5:1 — #316). */
export const ADMIN_ACTION_TONE_CLASS: Record<AdminActionTone, string> = {
  success: 'border-success/40 text-success-text hover:bg-success/10',
  error: 'border-error/40 text-error-text hover:bg-error/10',
  warning: 'border-warning/40 text-warning-text hover:bg-warning/10',
  neutral: 'border-border text-foreground hover:bg-soft',
};

/** Przycisk potwierdzenia w dialogu (pełne tło; biały tekst na wariancie `-text`). */
const CONFIRM_CLASS: Record<AdminActionTone, string> = {
  success: 'bg-success-text text-accent-foreground hover:opacity-90',
  error: 'bg-error-text text-accent-foreground hover:opacity-90',
  warning: 'bg-warning-text text-accent-foreground hover:opacity-90',
  neutral: 'bg-foreground text-background hover:opacity-90',
};

export const ADMIN_BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface AdminConfirmDialogProps {
  title: string;
  description: string;
  /** Dane pozycji pokazywane przed decyzją (lista `dt`/`dd`). */
  details: Array<{ key: string; label: string; value: string }>;
  confirmLabel: string;
  tone: AdminActionTone;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AdminConfirmDialog({
  title,
  description,
  details,
  confirmLabel,
  tone,
  pending,
  onConfirm,
  onCancel,
}: AdminConfirmDialogProps): React.JSX.Element {
  const t = useTranslations('admin');
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const idBase = React.useId();
  const titleId = `${idBase}-title`;
  const descId = `${idBase}-desc`;

  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Wyłączony przycisk traci fokus (przeglądarka przenosi go na <body>) — w trakcie zapisu
  // trzymamy fokus na samym dialogu (#415).
  React.useEffect(() => {
    if (pending) dialogRef.current?.focus();
  }, [pending]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!pending) onCancel();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (focusable.length === 0) {
      // W trakcie zapisu wszystkie przyciski są wyłączone — fokus zostaje w dialogu.
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={pending || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-left shadow-lg focus:outline-none sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p id={descId} className="mt-1 break-words text-sm text-muted-foreground">
          {description}
        </p>

        {details.length > 0 ? (
          <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 rounded-md bg-soft p-4 text-sm sm:grid-cols-[auto_1fr]">
            {details.map((item) => (
              <React.Fragment key={item.key}>
                <dt className="font-medium text-muted-foreground">{item.label}</dt>
                <dd className="break-words text-foreground">{item.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className={cn(ADMIN_BUTTON_BASE, 'border border-border bg-card text-foreground hover:bg-soft')}
          >
            {t('confirmCancel')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={cn(ADMIN_BUTTON_BASE, CONFIRM_CLASS[tone])}
          >
            {pending ? t('confirmSaving') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
