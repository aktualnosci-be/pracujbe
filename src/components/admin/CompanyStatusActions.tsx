'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { setCompanyStatus } from '@/lib/actions/admin';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { Toast } from '@/components/ui/toast';

/**
 * CompanyStatusActions — akcje zmiany statusu firmy (panel admina).
 *
 * Renderuje przyciski dozwolonych przejść zależnie od bieżącego statusu (nie pokazuje akcji
 * prowadzącej do stanu, w którym firma już jest). Wybór woła Server Action `setCompanyStatus`
 * (RPC `admin_set_company_status` z kontrolą `is_admin()` w DB — Invariant #8). Przyciski
 * zablokowane w trakcie zapisu (`useTransition`, Invariant #11); po sukcesie `router.refresh()`
 * + toast, przy błędzie toast z komunikatem i18n (bez technikaliów).
 */

const TOAST_MS = 4000;

/** Ton wizualny akcji (kolory tokenami). */
type ActionTone = 'success' | 'error' | 'warning' | 'neutral';

interface StatusAction {
  target: string;
  labelKey: string;
  tone: ActionTone;
}

/** Dostępne akcje zależnie od bieżącego statusu firmy. */
const ACTIONS_BY_STATUS: Record<string, StatusAction[]> = {
  unverified: [
    { target: 'verified', labelKey: 'actionVerify', tone: 'success' },
    { target: 'rejected', labelKey: 'actionReject', tone: 'error' },
  ],
  pending: [
    { target: 'verified', labelKey: 'actionVerify', tone: 'success' },
    { target: 'rejected', labelKey: 'actionReject', tone: 'error' },
  ],
  verified: [{ target: 'suspended', labelKey: 'actionSuspend', tone: 'warning' }],
  rejected: [{ target: 'verified', labelKey: 'actionVerify', tone: 'success' }],
  suspended: [{ target: 'verified', labelKey: 'actionReactivate', tone: 'success' }],
};

const TONE_CLASS: Record<ActionTone, string> = {
  success: 'border-success/30 text-success hover:bg-success/10',
  error: 'border-error/30 text-error hover:bg-error/10',
  warning: 'border-warning/30 text-warning hover:bg-warning/10',
  neutral: 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
};

export interface CompanyStatusActionsProps {
  companyId: string;
  status: string;
  className?: string;
}

export function CompanyStatusActions({
  companyId,
  status,
  className,
}: CompanyStatusActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();

  const [pending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );
  const router = useRouter();

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const actions = ACTIONS_BY_STATUS[status] ?? [];

  const handle = (target: string) => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await setCompanyStatus(companyId, target);
        if (res.ok) {
          setToast({ tone: 'success', message: t('statusChanged') });
          router.refresh();
        } else {
          setToast({ tone: 'error', message: tRoot(toUserMessageKey(res.error as ErrorCode)) });
        }
      } catch {
        setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
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
          onClick={() => handle(action.target)}
          className={cn(
            'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            TONE_CLASS[action.tone],
          )}
        >
          {t(action.labelKey)}
        </button>
      ))}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
