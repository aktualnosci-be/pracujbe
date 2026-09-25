'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { closeBreachIncident, reopenBreachIncident } from '@/lib/actions/breaches';
import {
  BREACH_FIELD_LABEL_KEY,
  BREACH_FIELDS,
  BREACH_LIMITS,
  breachNoteError,
  type BreachField,
} from '@/lib/admin/breach';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';
import { FORM_CONTROL, FORM_ERROR, FORM_HINT, FORM_LABEL_TEXT } from '@/components/admin/admin-styles';

/**
 * BreachStatusActions — zamknięcie i ponowne otwarcie wpisu rejestru (#490).
 *
 * Zamknięcie wymaga podsumowania; naruszenie danych osobowych zamyka się dopiero po
 * udokumentowaniu oceny ryzyka i decyzji (baza zwraca brakujący krok, który pokazujemy
 * w dialogu). Ponowne otwarcie wymaga powodu — oba teksty trafiają do niezmiennej historii.
 */

export interface BreachStatusActionsProps {
  id: string;
  version: number;
  status: string;
  reference: string;
}

export function BreachStatusActions({ id, version, status, reference }: BreachStatusActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const noteRef = React.useRef<HTMLTextAreaElement | null>(null);
  const idBase = React.useId();
  const closing = status === 'open';
  const max = closing ? BREACH_LIMITS.closureSummary : BREACH_LIMITS.reopenReason;

  const cancel = React.useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const confirm = () => {
    if (pending) return;
    const local = breachNoteError(note, max);
    if (local) {
      setError(t(local === 'tooLong' ? 'reasonTooLong' : 'reasonRequired', { max }));
      noteRef.current?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const res = closing
          ? await closeBreachIncident(id, version, note)
          : await reopenBreachIncident(id, version, note);
        if (res.ok) {
          setOpen(false);
          feedback.succeed({
            message: res.demo ? t('breachDemoNotSaved') : closing ? t('breachClosedToast') : t('breachReopenedToast'),
            focusKey: ADMIN_PAGE_HEADING_FOCUS,
          });
          return;
        }
        if (res.field) {
          setError(t(res.fieldError === 'tooLong' ? 'reasonTooLong' : 'reasonRequired', { max }));
          window.setTimeout(() => noteRef.current?.focus(), 0);
          return;
        }
        if (res.problem === 'notReady' && res.missing) {
          const field = (BREACH_FIELDS as readonly string[]).includes(res.missing)
            ? (res.missing as BreachField)
            : null;
          setError(
            t('breachNotReady', { field: field ? t(BREACH_FIELD_LABEL_KEY[field]) : res.missing }),
          );
          return;
        }
        if (res.error === 'STALE_STATE') {
          setOpen(false);
          feedback.succeed({ message: t('breachErrorStale'), focusKey: ADMIN_PAGE_HEADING_FOCUS, tone: 'error' });
          return;
        }
        feedback.fail(tRoot(toUserMessageKey(res.error)));
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const label = closing ? t('breachActionClose') : t('breachActionReopen');
  const noteId = `${idBase}-note`;
  const hintId = `${idBase}-hint`;
  const errorId = `${idBase}-error`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          setNote('');
          setError(null);
          setOpen(true);
        }}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.neutral)}
      >
        {label}
      </button>
      {open ? (
        <AdminConfirmDialog
          title={closing ? t('breachCloseTitle') : t('breachReopenTitle')}
          description={closing ? t('breachCloseHint') : t('breachReopenHint')}
          details={[{ key: 'reference', label: t('breachColReference'), value: reference }]}
          confirmLabel={label}
          tone={closing ? 'success' : 'warning'}
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
          initialFocusRef={noteRef}
        >
          <div className="mt-4 space-y-1.5">
            <label htmlFor={noteId} className={FORM_LABEL_TEXT}>
              {closing ? t('breachCloseSummaryLabel') : t('reasonLabel')}
            </label>
            <p id={hintId} className={FORM_HINT}>
              {t('breachNoteHint', { max })}
            </p>
            <textarea
              ref={noteRef}
              id={noteId}
              rows={4}
              required
              maxLength={max}
              value={note}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              onChange={(event) => {
                setNote(event.target.value);
                if (error) setError(null);
              }}
              className={FORM_CONTROL}
            />
            {error ? (
              <p id={errorId} role="alert" className={FORM_ERROR}>
                {error}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
