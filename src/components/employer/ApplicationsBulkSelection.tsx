'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { bulkTransitionApplications } from '@/lib/actions/applications';
import {
  BULK_TRANSITION_MAX,
  BULK_TRANSITION_OUTCOMES,
  summarizeBulkOutcomes,
  type BulkTransitionOutcome,
} from '@/lib/applications/bulk';
import { MENU_TARGET_STATUSES, type MenuTargetStatus } from '@/lib/applications/transitions';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { toCamel } from '@/components/ui/status-pill';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  BTN_PRIMARY,
  CHECKBOX,
  FORM_LABEL_TEXT,
  FORM_SELECT,
  PANEL,
  PANEL_P,
} from '@/components/dashboard/panel-styles';

/**
 * Akcja zbiorcza na liście zgłoszeń (/employer/aplikacje, 0170).
 *
 * `ApplicationsBulkSelection` trzyma zaznaczenie bieżącej strony listy (kontekst) i renderuje
 * pasek akcji: „zaznacz wszystkie na tej stronie”, wybór statusu docelowego, potwierdzenie
 * (ConfirmDialog — skutek dla wielu kandydatów naraz) i raport wyników per wynik RPC.
 * `BulkSelectCheckbox` w każdej karcie przełącza jedno zgłoszenie. Firma widoku
 * (`companyId`) wraca do akcji i jest sprawdzana na serwerze (ACTIVE_COMPANY_CHANGED).
 * W trakcie zapisu przycisk i pola są zablokowane (Invariant #11); po wyniku `router.refresh()`.
 */

interface SelectionContextValue {
  selected: ReadonlySet<string>;
  toggle: (id: string, on: boolean) => void;
  disabled: boolean;
}

const SelectionContext = React.createContext<SelectionContextValue | null>(null);

export interface BulkApplicationItem {
  id: string;
}

export interface ApplicationsBulkSelectionProps {
  companyId: string;
  applications: readonly BulkApplicationItem[];
  children: React.ReactNode;
}

export function ApplicationsBulkSelection({
  companyId,
  applications,
  children,
}: ApplicationsBulkSelectionProps): React.JSX.Element {
  const t = useTranslations('dashboard');
  const ts = useTranslations('status');
  const tc = useTranslations('common');
  const tRoot = useTranslations();
  const router = useRouter();
  const fieldId = React.useId();
  const allRef = React.useRef<HTMLInputElement>(null);
  const reportRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [target, setTarget] = React.useState<MenuTargetStatus>('rejected');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [report, setReport] = React.useState<Record<BulkTransitionOutcome, number> | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const pageIds = React.useMemo(() => applications.map((a) => a.id), [applications]);
  // Zaznaczenie dotyczy tylko bieżącej strony — po odświeżeniu listy zostają znane ID.
  const visibleSelected = pageIds.filter((id) => selected.has(id));
  const count = visibleSelected.length;
  const allChecked = count > 0 && count === pageIds.length;

  React.useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = count > 0 && !allChecked;
  }, [count, allChecked]);

  const toggle = React.useCallback((id: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function toggleAll(on: boolean): void {
    setSelected(on ? new Set(pageIds.slice(0, BULK_TRANSITION_MAX)) : new Set());
  }

  function run(): void {
    const ids = visibleSelected.slice(0, BULK_TRANSITION_MAX);
    if (ids.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await bulkTransitionApplications(ids, target, companyId);
        if (result.ok) {
          setReport(summarizeBulkOutcomes(result.results));
          setSelected(new Set());
          setConfirmOpen(false);
          router.refresh();
        } else {
          setConfirmOpen(false);
          setError(tRoot(toUserMessageKey(result.error)));
        }
      } catch {
        setConfirmOpen(false);
        setError(t('bulkStatusUncertain'));
      }
      requestAnimationFrame(() => reportRef.current?.focus());
    });
  }

  const statusLabel = ts(toCamel(target));

  function outcomeText(outcome: BulkTransitionOutcome, n: number): string {
    switch (outcome) {
      case 'changed':
        return t('bulkOutcomeChanged', { count: n });
      case 'unchanged':
        return t('bulkOutcomeUnchanged', { count: n });
      case 'invalid_transition':
        return t('bulkOutcomeInvalidTransition', { count: n });
      case 'not_found':
        return t('bulkOutcomeNotFound', { count: n });
      case 'permission_denied':
        return t('bulkOutcomePermissionDenied', { count: n });
      default:
        return t('bulkOutcomeError', { count: n });
    }
  }

  return (
    <SelectionContext.Provider value={{ selected, toggle, disabled: pending }}>
      <section aria-labelledby={`${fieldId}-title`} className={cn(PANEL, 'space-y-4')}>
        <h2 id={`${fieldId}-title`} className="text-base font-bold text-foreground">
          {t('bulkStatusTitle')}
        </h2>
        <div className="flex min-w-0 flex-wrap items-end gap-4">
          <label className="flex min-h-11 items-center gap-2 text-[13px] font-semibold text-foreground">
            <input
              ref={allRef}
              type="checkbox"
              className={CHECKBOX}
              checked={allChecked}
              disabled={pending}
              onChange={(event) => toggleAll(event.target.checked)}
            />
            {t('bulkSelectAllOnPage')}
          </label>
          <label className="flex min-w-[12rem] flex-col gap-2">
            <span className={FORM_LABEL_TEXT}>{t('bulkTargetLabel')}</span>
            <select
              className={FORM_SELECT}
              value={target}
              disabled={pending}
              onChange={(event) => setTarget(event.target.value as MenuTargetStatus)}
            >
              {MENU_TARGET_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ts(toCamel(status))}
                </option>
              ))}
            </select>
          </label>
          <button
            ref={triggerRef}
            type="button"
            className={cn(BTN_PRIMARY, 'disabled:opacity-60')}
            disabled={count === 0 || pending}
            onClick={() => setConfirmOpen(true)}
          >
            {pending ? t('bulkApplying') : t('bulkApply', { count })}
          </button>
        </div>
        <p className={PANEL_P} aria-live="polite">
          {t('bulkSelectedCount', { count, max: BULK_TRANSITION_MAX })}
        </p>
        <div ref={reportRef} tabIndex={-1} className="outline-none">
          {error ? (
            <p role="alert" className="text-[13px] text-error">
              {error}
            </p>
          ) : null}
          {report ? (
            <div role="status">
              <p className="text-[13px] font-semibold text-foreground">{t('bulkReportTitle')}</p>
              <ul className="mt-1 list-disc pl-5 text-[13px] text-foreground">
                {BULK_TRANSITION_OUTCOMES.filter((o) => report[o] > 0).map((o) => (
                  <li key={o}>{outcomeText(o, report[o])}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
      {children}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('bulkConfirmTitle', { count })}
        description={t('bulkConfirmDescription', { status: statusLabel })}
        confirmLabel={t('bulkConfirm')}
        cancelLabel={tc('cancel')}
        onConfirm={run}
        pending={pending}
        getReturnFocus={() => (report || error ? reportRef.current : triggerRef.current)}
      />
    </SelectionContext.Provider>
  );
}

export interface BulkSelectCheckboxProps {
  applicationId: string;
  /** Dostępna nazwa: kandydat + oferta (kilka pól na liście musi być rozróżnialnych). */
  label: string;
}

export function BulkSelectCheckbox({ applicationId, label }: BulkSelectCheckboxProps): React.JSX.Element | null {
  const ctx = React.useContext(SelectionContext);
  if (!ctx) return null;
  return (
    <label className="inline-flex size-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        className={CHECKBOX}
        aria-label={label}
        checked={ctx.selected.has(applicationId)}
        disabled={ctx.disabled}
        onChange={(event) => ctx.toggle(applicationId, event.target.checked)}
      />
    </label>
  );
}
