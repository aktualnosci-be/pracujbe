'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { setCompanyStatus } from '@/lib/actions/admin';
import type { AdminCompanyRow } from '@/lib/data/admin';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { COMPANY_STATUS_KEY } from '@/components/admin/AdminStatusBadge';
import { Toast } from '@/components/ui/toast';

/**
 * CompanyStatusActions — akcje zmiany statusu firmy (panel admina).
 *
 * Renderuje przyciski dozwolonych przejść zależnie od bieżącego statusu (nie pokazuje akcji
 * prowadzącej do stanu, w którym firma już jest). Kliknięcie NIE zmienia statusu od razu (#310):
 * otwiera dialog potwierdzenia z danymi weryfikacyjnymi firmy (VAT/KBO, e-mail, miasto, data
 * rejestracji) i przejściem „obecny → nowy status”. Dopiero potwierdzenie woła Server Action
 * `setCompanyStatus` (RPC `admin_set_company_status` z kontrolą `is_admin()` w DB — Invariant #8).
 * RPC nie przyjmuje uzasadnienia, więc dialog nie zbiera powodu (brak opisany w #310).
 *
 * Dialog: `role="alertdialog"` + `aria-modal`, fokus startuje na „Anuluj”, Tab zapętlony,
 * Escape zamyka, po zamknięciu fokus wraca na przycisk akcji. Przyciski zablokowane w trakcie
 * zapisu (`useTransition`, Invariant #11); po sukcesie `router.refresh()` + toast, przy błędzie
 * toast z komunikatem i18n (bez technikaliów).
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

/** Tekst na białym tle → warianty `-text` (WCAG AA 4,5:1 — #316); tła/obramowania bazowe. */
const TONE_CLASS: Record<ActionTone, string> = {
  success: 'border-success/40 text-success-text hover:bg-success/10',
  error: 'border-error/40 text-error-text hover:bg-error/10',
  warning: 'border-warning/40 text-warning-text hover:bg-warning/10',
  neutral: 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
};

/** Przycisk potwierdzenia w dialogu (pełne tło; biały tekst na wariancie `-text`). */
const CONFIRM_CLASS: Record<ActionTone, string> = {
  success: 'bg-success-text text-accent-foreground hover:opacity-90',
  error: 'bg-error-text text-accent-foreground hover:opacity-90',
  warning: 'bg-warning-text text-accent-foreground hover:opacity-90',
  neutral: 'bg-primary text-primary-foreground hover:opacity-90',
};

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface CompanyStatusActionsProps {
  company: AdminCompanyRow;
  /** Data utworzenia sformatowana przez stronę (locale widoku). */
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

  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<StatusAction | null>(null);
  const [toast, setToast] = React.useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const router = useRouter();

  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const idBase = React.useId();
  const titleId = `${idBase}-title`;
  const descId = `${idBase}-desc`;

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const close = React.useCallback(() => {
    setConfirming(null);
    // Fokus wraca na przycisk, który otworzył dialog (po odmontowaniu dialogu).
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  React.useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
  }, [confirming]);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!pending) close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (focusable.length === 0) return;
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

  const actions = ACTIONS_BY_STATUS[company.status] ?? [];

  const confirm = () => {
    if (pending || !confirming) return;
    const target = confirming.target;
    startTransition(async () => {
      try {
        const res = await setCompanyStatus(company.id, target);
        if (res.ok) {
          setToast({ tone: 'success', message: t('statusChanged') });
          close();
          router.refresh();
        } else {
          setToast({
            tone: 'error',
            message: tRoot(toUserMessageKey(res.error as ErrorCode)),
          });
        }
      } catch {
        setToast({
          tone: 'error',
          message: tRoot(toUserMessageKey('INTERNAL')),
        });
      }
    });
  };

  if (actions.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('noActions')}</span>;
  }

  const statusLabel = (status: string) => t(COMPANY_STATUS_KEY[status] ?? 'statusUnverified');
  const details: Array<{ key: string; label: string; value: string }> = [
    { key: 'vat', label: t('detailVat'), value: company.vatNumber ?? '—' },
    {
      key: 'kbo',
      label: t('detailRegistration'),
      value: company.registrationNumber ?? '—',
    },
    { key: 'email', label: t('detailEmail'), value: company.email ?? '—' },
    { key: 'city', label: t('detailCity'), value: company.city ?? '—' },
    { key: 'created', label: t('colCreated'), value: createdLabel },
  ];

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
          className={cn(BUTTON_BASE, 'border bg-card', TONE_CLASS[action.tone])}
        >
          {t(action.labelKey)}
        </button>
      ))}

      {confirming ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            onKeyDown={onDialogKeyDown}
            className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-left shadow-lg sm:p-6"
          >
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              {t('confirmTitle', { action: t(confirming.labelKey) })}
            </h2>
            <p id={descId} className="mt-1 text-sm text-muted-foreground">
              {t('confirmDescription', {
                name: company.name,
                from: statusLabel(company.status),
                to: statusLabel(confirming.target),
              })}
            </p>

            <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 rounded-md bg-soft p-4 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="font-medium text-muted-foreground">{t('colName')}</dt>
              <dd className="break-words font-semibold text-foreground">{company.name}</dd>
              {details.map((item) => (
                <React.Fragment key={item.key}>
                  <dt className="font-medium text-muted-foreground">{item.label}</dt>
                  <dd className="break-words text-foreground">{item.value}</dd>
                </React.Fragment>
              ))}
            </dl>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                disabled={pending}
                onClick={close}
                className={cn(
                  BUTTON_BASE,
                  'border border-border bg-card text-foreground hover:bg-soft',
                )}
              >
                {t('confirmCancel')}
              </button>
              <button
                type="button"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={confirm}
                className={cn(BUTTON_BASE, CONFIRM_CLASS[confirming.tone])}
              >
                {pending ? t('confirmSaving') : t(confirming.labelKey)}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[80] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
