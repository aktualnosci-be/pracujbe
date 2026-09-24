'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { decideScreeningReview } from '@/lib/actions/admin';
import { screeningReviewFocusKey } from '@/lib/admin/focus';
import { SCREENING_REVIEW_REASON_MAX } from '@/lib/screening/risk';
import { screeningReviewReasonError, type ScreeningReviewDecision } from '@/lib/screening/review';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * ScreeningReviewActions — decyzja o pytaniu screeningowym oznaczonym przez detektor (#497).
 *
 * „Zaakceptuj” i „Odrzuć” otwierają dialog z treścią pytania i kategoriami; odrzucenie wymaga
 * uzasadnienia (firma widzi je w kreatorze; trafia do dziennika zdarzeń), przy akceptacji jest
 * opcjonalne. Te same limity w RPC `admin_decide_screening_review` (0104). Akceptacja nie
 * publikuje oferty — robi to firma. Fokus i komunikaty przez `AdminFeedbackProvider` (#415).
 */

export interface ScreeningReviewActionsProps {
  id: string;
  /** Treść pytania (już w języku widoku). */
  promptLabel: string;
  /** Kategorie ryzyka (już przetłumaczone, rozdzielone przecinkami). */
  categoriesLabel: string;
  className?: string;
}

export function ScreeningReviewActions({
  id,
  promptLabel,
  categoriesLabel,
  className,
}: ScreeningReviewActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [decision, setDecision] = React.useState<ScreeningReviewDecision | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState<'required' | 'tooLong' | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const idBase = React.useId();
  const reasonId = `${idBase}-reason`;
  const reasonHintId = `${idBase}-reason-hint`;
  const reasonErrorId = `${idBase}-reason-error`;

  const cancel = React.useCallback(() => {
    setDecision(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const open = (next: ScreeningReviewDecision, event: React.MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    setReason('');
    setReasonError(null);
    setDecision(next);
  };

  const confirm = () => {
    if (pending || !decision) return;
    const localError = screeningReviewReasonError(decision, reason);
    if (localError) {
      setReasonError(localError);
      reasonRef.current?.focus();
      return;
    }
    const chosen = decision;
    startTransition(async () => {
      try {
        const res = await decideScreeningReview(id, chosen, reason);
        if (!res.ok && res.field === 'reason') {
          setReasonError(res.reason ?? 'required');
          window.setTimeout(() => reasonRef.current?.focus(), 0);
        } else if (res.ok) {
          setDecision(null);
          feedback.succeed({
            message: t(chosen === 'approved' ? 'screeningApproved' : 'screeningRejected'),
            focusKey: screeningReviewFocusKey(id),
          });
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND') {
          setDecision(null);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: screeningReviewFocusKey(id),
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

  const rejecting = decision === 'rejected';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('approved', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.success)}
      >
        {t('screeningActionApprove')}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('rejected', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.error)}
      >
        {t('screeningActionReject')}
      </button>

      {decision ? (
        <AdminConfirmDialog
          title={t(rejecting ? 'screeningRejectConfirmTitle' : 'screeningApproveConfirmTitle')}
          description={t(rejecting ? 'screeningRejectConfirmHint' : 'screeningApproveConfirmHint')}
          details={[
            { key: 'prompt', label: t('screeningColQuestion'), value: promptLabel },
            { key: 'categories', label: t('screeningColCategories'), value: categoriesLabel },
          ]}
          confirmLabel={t(rejecting ? 'screeningActionReject' : 'screeningActionApprove')}
          tone={rejecting ? 'error' : 'success'}
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
          initialFocusRef={reasonRef}
        >
          <div className="mt-4 space-y-1.5">
            <label htmlFor={reasonId} className="block text-sm font-medium text-foreground">
              {t(rejecting ? 'reasonLabel' : 'screeningReasonOptionalLabel')}
            </label>
            <p id={reasonHintId} className="text-xs text-muted-foreground">
              {t('screeningReasonHint', { max: SCREENING_REVIEW_REASON_MAX })}
            </p>
            <textarea
              ref={reasonRef}
              id={reasonId}
              name="reason"
              rows={4}
              required={rejecting}
              maxLength={SCREENING_REVIEW_REASON_MAX}
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
                  max: SCREENING_REVIEW_REASON_MAX,
                })}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
