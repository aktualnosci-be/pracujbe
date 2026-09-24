'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { setCompanyStatus } from '@/lib/actions/admin';
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
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const cancel = React.useCallback(() => {
    setConfirming(null);
    // Fokus wraca na przycisk, który otworzył dialog (po odmontowaniu dialogu).
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const actions = COMPANY_ACTIONS_BY_STATUS[company.status] ?? [];

  const confirm = () => {
    if (pending || !confirming) return;
    const target = confirming.target;
    startTransition(async () => {
      try {
        const res = await setCompanyStatus(company.id, target, company.status);
        if (res.ok) {
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
            setConfirming(action);
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
        />
      ) : null}
    </div>
  );
}
