'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { resolveReport } from '@/lib/actions/admin';
import { reportFocusKey } from '@/lib/admin/focus';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
  type AdminActionTone,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * ReportActions — akcje rozstrzygnięcia zgłoszenia (panel admina).
 *
 * Przyciski dozwolonych przejść zależnie od bieżącego statusu (ta sama macierz w RPC
 * `admin_resolve_report`, 0081 — #420). „Weź do analizy”/„Otwórz ponownie” to kroki odwracalne
 * — zapis od razu. Rozstrzygnięcie („Rozwiąż”, „Oddal zgłoszenie”) wymaga potwierdzenia w
 * dialogu z celem zgłoszenia (#422). Tony zgodne z semantyką: czerwień tylko dla błędów/akcji
 * destrukcyjnych, więc kroki neutralne mają ton neutralny.
 *
 * Fokus i komunikaty (#415) obsługuje `AdminFeedbackProvider`: po sukcesie fokus na nagłówku
 * karty zgłoszenia (`data-admin-focus="report-<id>"`), a gdy karta opuściła filtr — na
 * nagłówku strony. Nigdy na `<body>`.
 */

interface ReportAction {
  target: string;
  labelKey: string;
  tone: AdminActionTone;
  /** Rozstrzygnięcie — wymaga potwierdzenia. */
  confirm: boolean;
}

/** Dostępne akcje zależnie od bieżącego statusu zgłoszenia (zgodne z macierzą w DB, 0081). */
export const REPORT_ACTIONS_BY_STATUS: Record<string, ReportAction[]> = {
  open: [
    { target: 'reviewing', labelKey: 'actionReview', tone: 'neutral', confirm: false },
    { target: 'resolved', labelKey: 'actionResolve', tone: 'success', confirm: true },
    { target: 'dismissed', labelKey: 'actionDismissReport', tone: 'neutral', confirm: true },
  ],
  reviewing: [
    { target: 'resolved', labelKey: 'actionResolve', tone: 'success', confirm: true },
    { target: 'dismissed', labelKey: 'actionDismissReport', tone: 'neutral', confirm: true },
  ],
  resolved: [{ target: 'reviewing', labelKey: 'actionReopen', tone: 'neutral', confirm: false }],
  dismissed: [{ target: 'reviewing', labelKey: 'actionReopen', tone: 'neutral', confirm: false }],
};

export interface ReportActionsProps {
  reportId: string;
  status: string;
  /** Typ celu (etykieta i18n, np. „Oferta”) — do dialogu potwierdzenia. */
  targetTypeLabel: string;
  /** Nazwa/tytuł celu albo jego stan („Obiekt usunięty”) — do dialogu potwierdzenia. */
  targetLabel: string;
  /** Etykieta powodu zgłoszenia (już przetłumaczona). */
  reasonLabel: string;
  className?: string;
}

export function ReportActions({
  reportId,
  status,
  targetTypeLabel,
  targetLabel,
  reasonLabel,
  className,
}: ReportActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<ReportAction | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const actions = REPORT_ACTIONS_BY_STATUS[status] ?? [];

  const cancel = React.useCallback(() => {
    setConfirming(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const run = (target: string) => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await resolveReport(reportId, target, status);
        if (res.ok) {
          setConfirming(null);
          feedback.succeed({ message: t('reportResolved'), focusKey: reportFocusKey(reportId) });
        } else if (res.error === 'STALE_STATE' || res.error === 'INVALID_TRANSITION') {
          setConfirming(null);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: reportFocusKey(reportId),
            tone: 'error',
          });
        } else {
          feedback.fail(tRoot(toUserMessageKey(res.error as ErrorCode)));
        }
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  if (actions.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('noActions')}</span>;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {actions.map((action) => (
        <button
          key={action.target}
          type="button"
          disabled={pending}
          aria-haspopup={action.confirm ? 'dialog' : undefined}
          aria-busy={(!action.confirm && pending) || undefined}
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            if (action.confirm) setConfirming(action);
            else run(action.target);
          }}
          className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS[action.tone])}
        >
          {t(action.labelKey)}
        </button>
      ))}

      {confirming ? (
        <AdminConfirmDialog
          title={t('reportConfirmTitle', { action: t(confirming.labelKey) })}
          description={t(
            confirming.target === 'resolved'
              ? 'reportConfirmResolveHint'
              : 'reportConfirmDismissHint',
          )}
          details={[
            { key: 'type', label: t('reportTargetType'), value: targetTypeLabel },
            { key: 'target', label: t('reportTarget'), value: targetLabel },
            { key: 'reason', label: t('reportReason'), value: reasonLabel },
          ]}
          confirmLabel={t(confirming.labelKey)}
          tone={confirming.tone}
          pending={pending}
          onConfirm={() => run(confirming.target)}
          onCancel={cancel}
        />
      ) : null}
    </div>
  );
}
