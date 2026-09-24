'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { liftEmailSuppression } from '@/lib/actions/admin';
import { emailSuppressionFocusKey } from '@/lib/admin/focus';
import { EMAIL_LIFT_REASON_MAX, emailLiftReasonError } from '@/lib/admin/email-suppression';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * EmailSuppressionActions — zdjęcie blokady adresu e-mail (#44, panel admina).
 *
 * Zdjęcie wymaga potwierdzenia w dialogu z adresem i powodem blokady oraz uzasadnienia
 * (trafia do dziennika zdarzeń; te same limity w RPC `admin_lift_email_suppression`, 0099).
 * Fokus i komunikaty przez `AdminFeedbackProvider` (#415): po sukcesie nagłówek wiersza,
 * a gdy wiersz opuścił filtr „Aktywne” — nagłówek strony.
 */

export interface EmailSuppressionActionsProps {
  id: string;
  email: string;
  /** Etykieta powodu blokady (już przetłumaczona). */
  reasonLabel: string;
  /** Data blokady (sformatowana przez stronę). */
  createdLabel: string;
  className?: string;
}

export function EmailSuppressionActions({
  id,
  email,
  reasonLabel,
  createdLabel,
  className,
}: EmailSuppressionActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState<'required' | 'tooLong' | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const idBase = React.useId();
  const reasonId = `${idBase}-reason`;
  const reasonHintId = `${idBase}-reason-hint`;
  const reasonErrorId = `${idBase}-reason-error`;

  const cancel = React.useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const confirm = () => {
    if (pending) return;
    const localError = emailLiftReasonError(reason);
    if (localError) {
      setReasonError(localError);
      reasonRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const res = await liftEmailSuppression(id, reason);
        if (!res.ok && res.field === 'reason') {
          setReasonError(res.reason ?? 'required');
          window.setTimeout(() => reasonRef.current?.focus(), 0);
        } else if (res.ok) {
          setOpen(false);
          feedback.succeed({ message: t('emailLifted'), focusKey: emailSuppressionFocusKey(id) });
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND') {
          setOpen(false);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: emailSuppressionFocusKey(id),
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

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          setReason('');
          setReasonError(null);
          setOpen(true);
        }}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.neutral)}
      >
        {t('emailActionLift')}
      </button>

      {open ? (
        <AdminConfirmDialog
          title={t('emailLiftConfirmTitle')}
          description={t('emailLiftConfirmHint')}
          details={[
            { key: 'email', label: t('colEmail'), value: email },
            { key: 'reason', label: t('emailColReason'), value: reasonLabel },
            { key: 'created', label: t('colCreated'), value: createdLabel },
          ]}
          confirmLabel={t('emailActionLift')}
          tone="warning"
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
          initialFocusRef={reasonRef}
        >
          <div className="mt-4 space-y-1.5">
            <label htmlFor={reasonId} className="block text-sm font-medium text-foreground">
              {t('reasonLabel')}
            </label>
            <p id={reasonHintId} className="text-xs text-muted-foreground">
              {t('emailLiftReasonHint', { max: EMAIL_LIFT_REASON_MAX })}
            </p>
            <textarea
              ref={reasonRef}
              id={reasonId}
              name="reason"
              rows={4}
              required
              maxLength={EMAIL_LIFT_REASON_MAX}
              value={reason}
              disabled={pending}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${reasonHintId} ${reasonErrorId}` : reasonHintId}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error"
            />
            {reasonError ? (
              <p id={reasonErrorId} className="text-sm font-medium text-error-text">
                {t(reasonError === 'tooLong' ? 'reasonTooLong' : 'reasonRequired', {
                  max: EMAIL_LIFT_REASON_MAX,
                })}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
