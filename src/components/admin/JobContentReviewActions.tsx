'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { decideJobContentReview } from '@/lib/actions/job-trust';
import { jobContentReviewFocusKey } from '@/lib/admin/focus';
import {
  JOB_CONTENT_REVIEW_REASON_MAX,
  jobContentReviewReasonError,
  type JobContentReviewDecision,
} from '@/lib/job-trust/review';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * JobContentReviewActions — decyzja o treści oferty z sygnałem oszustwa (0167; reguły albo AI).
 *
 * „Zaakceptuj” i „Odrzuć” otwierają dialog z ofertą i kategoriami; odrzucenie wymaga
 * uzasadnienia (firma widzi je w kreatorze; trafia do dziennika zdarzeń). Te same limity w RPC
 * `admin_decide_job_content_review`. Akceptacja nie publikuje ani nie wznawia oferty.
 */

export interface JobContentReviewActionsProps {
  id: string;
  /** Tytuł oferty i firma (tekst do dialogu). */
  jobLabel: string;
  /** Kategorie ryzyka (już przetłumaczone, rozdzielone przecinkami). */
  categoriesLabel: string;
  className?: string;
}

export function JobContentReviewActions({
  id,
  jobLabel,
  categoriesLabel,
  className,
}: JobContentReviewActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [decision, setDecision] = React.useState<JobContentReviewDecision | null>(null);
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

  const open = (next: JobContentReviewDecision, event: React.MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    setReason('');
    setReasonError(null);
    setDecision(next);
  };

  const confirm = () => {
    if (pending || !decision) return;
    const localError = jobContentReviewReasonError(decision, reason);
    if (localError) {
      setReasonError(localError);
      reasonRef.current?.focus();
      return;
    }
    const chosen = decision;
    startTransition(async () => {
      try {
        const res = await decideJobContentReview(id, chosen, reason);
        if (!res.ok && res.field === 'reason') {
          setReasonError(res.reason ?? 'required');
          window.setTimeout(() => reasonRef.current?.focus(), 0);
        } else if (res.ok) {
          setDecision(null);
          feedback.succeed({
            message: t(chosen === 'approved' ? 'jobContentApproved' : 'jobContentRejected'),
            focusKey: jobContentReviewFocusKey(id),
          });
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND') {
          setDecision(null);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: jobContentReviewFocusKey(id),
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
        {t('jobContentActionApprove')}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('rejected', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.error)}
      >
        {t('jobContentActionReject')}
      </button>

      {decision ? (
        <AdminConfirmDialog
          title={t(rejecting ? 'jobContentRejectConfirmTitle' : 'jobContentApproveConfirmTitle')}
          description={t(rejecting ? 'jobContentRejectConfirmHint' : 'jobContentApproveConfirmHint')}
          details={[
            { key: 'job', label: t('jobContentColJob'), value: jobLabel },
            { key: 'categories', label: t('jobContentColCategories'), value: categoriesLabel },
          ]}
          confirmLabel={t(rejecting ? 'jobContentActionReject' : 'jobContentActionApprove')}
          tone={rejecting ? 'error' : 'success'}
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
          initialFocusRef={reasonRef}
        >
          <div className="mt-4 space-y-1.5">
            <label htmlFor={reasonId} className="block text-sm font-medium text-foreground">
              {t(rejecting ? 'reasonLabel' : 'jobContentReasonOptionalLabel')}
            </label>
            <p id={reasonHintId} className="text-xs text-muted-foreground">
              {t('jobContentReasonHint', { max: JOB_CONTENT_REVIEW_REASON_MAX })}
            </p>
            <textarea
              ref={reasonRef}
              id={reasonId}
              name="reason"
              rows={4}
              required={rejecting}
              maxLength={JOB_CONTENT_REVIEW_REASON_MAX}
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
                  max: JOB_CONTENT_REVIEW_REASON_MAX,
                })}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
