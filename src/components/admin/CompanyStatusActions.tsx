'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { setCompanyStatus } from '@/lib/actions/admin';
import {
  COMPANY_REASON_MAX,
  companyReasonError,
  companyStatusNeedsReason,
} from '@/lib/admin/company-review';
import type { AdminCompanyRow } from '@/lib/data/admin';
import { companyFocusKey } from '@/lib/admin/focus';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
  type AdminActionTone,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';
import { COMPANY_STATUS_KEY } from '@/components/admin/AdminStatusBadge';

/**
 * CompanyStatusActions — akcje zmiany statusu firmy (panel admina).
 *
 * Renderuje przyciski dozwolonych przejść zależnie od bieżącego statusu (ta sama macierz
 * egzekwowana w RPC `admin_set_company_status`, 0081 — #420). Kliknięcie NIE zmienia statusu
 * od razu (#310): otwiera dialog potwierdzenia z danymi weryfikacyjnymi firmy i przejściem
 * „obecny → nowy status”. Potwierdzenie woła Server Action `setCompanyStatus` ze statusem
 * widzianym przez admina (`STALE_STATE`, gdy inny admin zdążył go zmienić).
 *
 * Uzasadnienie (#310): odrzucenie i zawieszenie wymagają powodu (pole w dialogu, fokus startuje
 * na nim; błąd przy polu z `aria-invalid`/`aria-describedby`, limit jak w bazie). Powód trafia
 * do właściciela firmy (powiadomienie + e-mail w JEGO języku — RPC 0084) i do dziennika.
 *
 * Fokus i komunikaty (#415): Anuluj/Escape oddaje fokus przyciskowi akcji; po sukcesie toast
 * i fokus obsługuje `AdminFeedbackProvider` (poza wierszem, który po odświeżeniu może zniknąć):
 * nagłówek wiersza firmy (`data-admin-focus="company-<id>"`) albo nagłówek strony.
 */

interface StatusAction {
  target: string;
  labelKey: string;
  tone: AdminActionTone;
}

/** Dostępne akcje zależnie od bieżącego statusu firmy (zgodne z macierzą w DB, 0081). */
export const COMPANY_ACTIONS_BY_STATUS: Record<string, StatusAction[]> = {
  unverified: [
    { target: 'verified', labelKey: 'actionVerify', tone: 'success' },
    { target: 'rejected', labelKey: 'actionRejectCompany', tone: 'error' },
  ],
  pending: [
    { target: 'verified', labelKey: 'actionVerify', tone: 'success' },
    { target: 'rejected', labelKey: 'actionRejectCompany', tone: 'error' },
  ],
  verified: [{ target: 'suspended', labelKey: 'actionSuspend', tone: 'warning' }],
  rejected: [{ target: 'verified', labelKey: 'actionVerify', tone: 'success' }],
  suspended: [{ target: 'verified', labelKey: 'actionReactivate', tone: 'success' }],
};

export interface CompanyStatusActionsProps {
  company: AdminCompanyRow;
  /** Data utworzenia sformatowana przez stronę (locale widoku, Europe/Brussels). */
  createdLabel: string;
  className?: string;
}

export function CompanyStatusActions({
  company,
  createdLabel,
  className,
}: CompanyStatusActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<StatusAction | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonError, setReasonError] = React.useState<'required' | 'tooLong' | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const idBase = React.useId();
  const reasonId = `${idBase}-reason`;
  const reasonHintId = `${idBase}-reason-hint`;
  const reasonErrorId = `${idBase}-reason-error`;

  const openDialog = (action: StatusAction) => {
    setReason('');
    setReasonError(null);
    setConfirming(action);
  };

  const cancel = React.useCallback(() => {
    setConfirming(null);
    // Fokus wraca na przycisk, który otworzył dialog (po odmontowaniu dialogu).
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const actions = COMPANY_ACTIONS_BY_STATUS[company.status] ?? [];

  const confirm = () => {
    if (pending || !confirming) return;
    const target = confirming.target;
    const localError = companyReasonError(target, reason);
    if (localError) {
      setReasonError(localError);
      reasonRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const res = await setCompanyStatus(
          company.id,
          target,
          company.status,
          companyStatusNeedsReason(target) ? reason : null,
        );
        if (!res.ok && res.field === 'reason') {
          setReasonError(res.reason ?? 'required');
          window.setTimeout(() => reasonRef.current?.focus(), 0);
        } else if (res.ok) {
          setConfirming(null);
          feedback.succeed({
            message: t('statusChanged'),
            focusKey: companyFocusKey(company.id),
          });
        } else if (res.error === 'STALE_STATE' || res.error === 'INVALID_TRANSITION') {
          // Widok był nieaktualny: zamykamy dialog i odświeżamy wiersz z komunikatem (#420).
          setConfirming(null);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: companyFocusKey(company.id),
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

  const statusLabel = (status: string) => t(COMPANY_STATUS_KEY[status] ?? 'statusUnverified');

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {actions.map((action) => (
        <button
          key={action.target}
          type="button"
          disabled={pending}
          aria-haspopup="dialog"
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            openDialog(action);
          }}
          className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS[action.tone])}
        >
          {t(action.labelKey)}
        </button>
      ))}

      {confirming ? (
        <AdminConfirmDialog
          title={t('confirmTitle', { action: t(confirming.labelKey) })}
          description={t('confirmDescription', {
            name: company.name,
            from: statusLabel(company.status),
            to: statusLabel(confirming.target),
          })}
          details={[
            { key: 'name', label: t('colName'), value: company.name },
            { key: 'vat', label: t('detailVat'), value: company.vatNumber ?? '—' },
            {
              key: 'kbo',
              label: t('detailRegistration'),
              value: company.registrationNumber ?? '—',
            },
            { key: 'email', label: t('detailEmail'), value: company.email ?? '—' },
            { key: 'city', label: t('detailCity'), value: company.city ?? '—' },
            { key: 'created', label: t('colCreated'), value: createdLabel },
          ]}
          confirmLabel={t(confirming.labelKey)}
          tone={confirming.tone}
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
          initialFocusRef={companyStatusNeedsReason(confirming.target) ? reasonRef : undefined}
        >
          {companyStatusNeedsReason(confirming.target) ? (
            <div className="mt-4 space-y-1.5">
              <label htmlFor={reasonId} className="block text-sm font-medium text-foreground">
                {t('reasonLabel')}
              </label>
              <p id={reasonHintId} className="text-xs text-muted-foreground">
                {t('reasonHint', { max: COMPANY_REASON_MAX })}
              </p>
              <textarea
                ref={reasonRef}
                id={reasonId}
                name="reason"
                rows={4}
                required
                maxLength={COMPANY_REASON_MAX}
                value={reason}
                disabled={pending}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={
                  reasonError ? `${reasonHintId} ${reasonErrorId}` : reasonHintId
                }
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError(null);
                }}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error"
              />
              {reasonError ? (
                <p id={reasonErrorId} className="text-sm font-medium text-error-text">
                  {t(reasonError === 'tooLong' ? 'reasonTooLong' : 'reasonRequired', {
                    max: COMPANY_REASON_MAX,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">{t('ownerNotifiedNote')}</p>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
