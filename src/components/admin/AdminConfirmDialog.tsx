'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { BTN_SMALL, PANEL, PANEL_H2 } from '@/components/admin/admin-styles';

/**
 * AdminConfirmDialog — dialog potwierdzenia decyzji admina (firmy #310, zgłoszenia #422).
 *
 * `role="alertdialog"` + `aria-modal`, fokus startuje na „Anuluj” (albo `initialFocusRef`,
 * np. na polu uzasadnienia), Tab zapętlony w dialogu (przyciski i pola),
 * Escape/„Anuluj” zamyka (rodzic oddaje fokus przyciskowi otwierającemu). W trakcie zapisu
 * przyciski zablokowane (Invariant #11), a Escape nie zamyka. Teksty przekazuje rodzic (i18n).
 */

export type AdminActionTone = 'success' | 'error' | 'warning' | 'neutral';

/** Przycisk akcji na białym tle → warianty `-text` (WCAG AA 4,5:1 — #316). */
export const ADMIN_ACTION_TONE_CLASS: Record<AdminActionTone, string> = {
  success: 'border-success/40 text-success-text hover:bg-success/10',
  error: 'border-error/40 text-error-text hover:bg-error/10',
  warning: 'border-warning/40 text-warning-text hover:bg-warning/10',
  neutral: 'border-input text-foreground hover:bg-soft',
};

/** Przycisk potwierdzenia w dialogu (pełne tło; biały tekst na wariancie `-text`). */
const CONFIRM_CLASS: Record<AdminActionTone, string> = {
  success: 'border-transparent bg-success-text text-accent-foreground hover:opacity-90',
  error: 'border-transparent bg-error-text text-accent-foreground hover:opacity-90',
  warning: 'border-transparent bg-warning-text text-accent-foreground hover:opacity-90',
  neutral: 'border-transparent bg-foreground text-background hover:opacity-90',
};

/** Przycisk akcji w wierszu = `.people .notice .btn` z prototypu (12 px / 650, 11/17 px, min. 44 px). */
export const ADMIN_BUTTON_BASE = BTN_SMALL;

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
  /** Dodatkowa treść pod danymi (np. pole uzasadnienia decyzji — #310). */
  children?: React.ReactNode;
  /** Element, który dostaje fokus po otwarciu (domyślnie „Anuluj”). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
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
  children,
  initialFocusRef,
}: AdminConfirmDialogProps): React.JSX.Element {
  const t = useTranslations('admin');
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const idBase = React.useId();
  const titleId = `${idBase}-title`;
  const descId = `${idBase}-desc`;

  React.useEffect(() => {
    (initialFocusRef?.current ?? cancelRef.current)?.focus();
    // Tylko przy otwarciu dialogu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled])',
      ),
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
    <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-foreground/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={pending || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(PANEL, 'max-h-full w-full max-w-md overflow-y-auto text-left shadow-lg focus:outline-none')}
      >
        <h2 id={titleId} className={PANEL_H2}>
          {title}
        </h2>
        <p id={descId} className="mt-1.5 break-words text-[13px] leading-[1.6] text-muted-foreground">
          {description}
        </p>

        {details.length > 0 ? (
          <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 rounded-[14px] border border-border bg-soft p-4 text-[13px] sm:grid-cols-[auto_1fr]">
            {details.map((item) => (
              <React.Fragment key={item.key}>
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="break-words font-semibold text-foreground">{item.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : null}

        {children}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className={cn(ADMIN_BUTTON_BASE, 'border border-input bg-card text-foreground hover:bg-soft')}
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
