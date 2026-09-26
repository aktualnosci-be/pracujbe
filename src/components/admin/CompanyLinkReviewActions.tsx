'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { reviewCompanyLink } from '@/lib/actions/admin';
import { companyLinkFocusKey } from '@/lib/admin/focus';
import {
  COMPANY_LINK_REASON_MAX,
  companyLinkReasonError,
  type CompanyLinkDecision,
  type CompanyLinkField,
} from '@/lib/admin/company-link-review';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * CompanyLinkReviewActions — decyzja o stronie WWW albo logo firmy czekającym na akceptację
 * (0144, „linki do zatwierdzenia”). „Zatwierdź” publikuje adres, „Odrzuć” usuwa zgłoszenie;
 * odrzucenie wymaga uzasadnienia (firma widzi je w `/employer/firma`). Dialog pokazuje
 * zgłoszony adres — ten sam trafia do RPC jako wartość oczekiwana (CAS → `STALE_STATE`).
 */

export interface CompanyLinkReviewActionsProps {
  companyId: string;
  field: CompanyLinkField;
  /** Zgłoszony adres. */
  value: string;
  /** Nazwa pola (już przetłumaczona). */
  fieldLabel: string;
  className?: string;
}

export function CompanyLinkReviewActions({
  companyId,
  field,
  value,
  fieldLabel,
  className,
}: CompanyLinkReviewActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [decision, setDecision] = React.useState<CompanyLinkDecision | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState<'required' | 'tooLong' | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const idBase = React.useId();
  const reasonId = `${idBase}-reason`;
  const reasonHintId = `${idBase}-reason-hint`;
  const reasonErrorId = `${idBase}-reason-error`;
  const focusKey = companyLinkFocusKey(companyId, field);

  const cancel = React.useCallback(() => {
    setDecision(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const open = (next: CompanyLinkDecision, event: React.MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    setReason('');
    setReasonError(null);
    setDecision(next);
  };

  const confirm = () => {
    if (pending || !decision) return;
    const localError = companyLinkReasonError(decision, reason);
    if (localError) {
      setReasonError(localError);
      reasonRef.current?.focus();
      return;
    }
    const chosen = decision;
    startTransition(async () => {
      try {
        const res = await reviewCompanyLink(companyId, field, chosen, value, reason);
        if (!res.ok && res.field === 'reason') {
          setReasonError(res.reason ?? 'required');
          window.setTimeout(() => reasonRef.current?.focus(), 0);
        } else if (res.ok) {
          setDecision(null);
          feedback.succeed({
            message: t(chosen === 'approve' ? 'companyLinkApproved' : 'companyLinkRejected'),
            focusKey,
          });
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND') {
          setDecision(null);
          feedback.succeed({ message: tRoot(toUserMessageKey(res.error)), focusKey, tone: 'error' });
        } else {
          feedback.fail(tRoot(toUserMessageKey(res.error as ErrorCode)));
        }
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const rejecting = decision === 'reject';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('approve', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.success)}
      >
        {t('companyLinkActionApprove')}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('reject', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.error)}
      >
        {t('companyLinkActionReject')}
      </button>

      {decision ? (
        <AdminConfirmDialog
          title={t(rejecting ? 'companyLinkRejectConfirmTitle' : 'companyLinkApproveConfirmTitle')}
          description={t(rejecting ? 'companyLinkRejectConfirmHint' : 'companyLinkApproveConfirmHint')}
          details={[
            { key: 'field', label: t('companyLinkColField'), value: fieldLabel },
            { key: 'value', label: t('companyLinkColValue'), value },
          ]}
          confirmLabel={t(rejecting ? 'companyLinkActionReject' : 'companyLinkActionApprove')}
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
              {t('companyLinkReasonHint', { max: COMPANY_LINK_REASON_MAX })}
            </p>
            <textarea
              ref={reasonRef}
              id={reasonId}
              name="reason"
              rows={4}
              required={rejecting}
              maxLength={COMPANY_LINK_REASON_MAX}
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
                  max: COMPANY_LINK_REASON_MAX,
                })}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
