'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { recordAgencyCheck } from '@/lib/actions/job-trust';
import { agencyCheckFocusKey } from '@/lib/admin/focus';
import { AGENCY_CHECK_NOTE_MAX } from '@/lib/job-trust/agency';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * AgencyCheckActions — wynik ręcznego sprawdzenia numeru uznania agencji pracy tymczasowej
 * w rejestrze regionu (0167, `/admin/firmy/[id]`). Admin wybiera „Numer potwierdzony” albo
 * „Nie potwierdzono”, notatka opcjonalna (≤ 1000). RPC `admin_record_agency_check` porównuje
 * numer widziany przez admina z bieżącym (`STALE_STATE`, gdy firma zmieniła deklarację).
 */

type AgencyCheckResult = 'confirmed' | 'not_confirmed';

export interface AgencyCheckActionsProps {
  companyId: string;
  recognitionNumber: string;
}

export function AgencyCheckActions({ companyId, recognitionNumber }: AgencyCheckActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<AgencyCheckResult | null>(null);
  const [note, setNote] = React.useState('');
  const [noteError, setNoteError] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const noteRef = React.useRef<HTMLTextAreaElement | null>(null);
  const idBase = React.useId();
  const noteId = `${idBase}-note`;
  const noteHintId = `${idBase}-note-hint`;
  const noteErrorId = `${idBase}-note-error`;

  const cancel = React.useCallback(() => {
    setResult(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const open = (next: AgencyCheckResult, event: React.MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    setNote('');
    setNoteError(false);
    setResult(next);
  };

  const confirm = () => {
    if (pending || !result) return;
    if (note.trim().length > AGENCY_CHECK_NOTE_MAX) {
      setNoteError(true);
      noteRef.current?.focus();
      return;
    }
    const chosen = result;
    startTransition(async () => {
      try {
        const res = await recordAgencyCheck(companyId, chosen, recognitionNumber, note);
        if (res.ok) {
          setResult(null);
          feedback.succeed({
            message: t(chosen === 'confirmed' ? 'agencyCheckSavedConfirmed' : 'agencyCheckSavedNotConfirmed'),
            focusKey: agencyCheckFocusKey(companyId),
          });
        } else if (res.field === 'note') {
          setNoteError(true);
          window.setTimeout(() => noteRef.current?.focus(), 0);
        } else if (res.error === 'STALE_STATE' || res.error === 'NOT_FOUND') {
          setResult(null);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: agencyCheckFocusKey(companyId),
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

  const negative = result === 'not_confirmed';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('confirmed', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.success)}
      >
        {t('agencyCheckActionConfirm')}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => open('not_confirmed', event)}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.error)}
      >
        {t('agencyCheckActionNotConfirmed')}
      </button>

      {result ? (
        <AdminConfirmDialog
          title={t(negative ? 'agencyCheckNotConfirmedTitle' : 'agencyCheckConfirmTitle')}
          description={t('agencyCheckConfirmHint')}
          details={[{ key: 'number', label: t('agencyCheckNumber'), value: recognitionNumber }]}
          confirmLabel={t(negative ? 'agencyCheckActionNotConfirmed' : 'agencyCheckActionConfirm')}
          tone={negative ? 'error' : 'success'}
          pending={pending}
          onConfirm={confirm}
          onCancel={cancel}
          initialFocusRef={noteRef}
        >
          <div className="mt-4 space-y-1.5">
            <label htmlFor={noteId} className="block text-sm font-medium text-foreground">
              {t('agencyCheckNoteLabel')}
            </label>
            <p id={noteHintId} className="text-xs text-muted-foreground">
              {t('agencyCheckNoteHint', { max: AGENCY_CHECK_NOTE_MAX })}
            </p>
            <textarea
              ref={noteRef}
              id={noteId}
              name="note"
              rows={3}
              maxLength={AGENCY_CHECK_NOTE_MAX}
              value={note}
              disabled={pending}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? `${noteHintId} ${noteErrorId}` : noteHintId}
              onChange={(event) => {
                setNote(event.target.value);
                if (noteError) setNoteError(false);
              }}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error"
            />
            {noteError ? (
              <p id={noteErrorId} className="text-sm font-medium text-error-text">
                {t('reasonTooLong', { max: AGENCY_CHECK_NOTE_MAX })}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
