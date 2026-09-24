'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { decideReport, resolveReport, restoreModeration } from '@/lib/actions/admin';
import { reportFocusKey } from '@/lib/admin/focus';
import {
  decisionRestricts,
  decisionsForTarget,
  MODERATION_FACTS_MAX,
  MODERATION_FACTS_MIN,
  MODERATION_GROUND_REFERENCE_MAX,
  MODERATION_GROUND_REFERENCE_MIN,
  MODERATION_GROUNDS,
  MODERATION_RESTORE_REASON_MAX,
  MODERATION_RESTORE_REASON_MIN,
  moderationDecisionError,
  restoreReasonError,
  type ModerationDecision,
  type ModerationField,
  type ModerationFieldError,
} from '@/lib/admin/moderation';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * ModerationDecisionActions — rozstrzygnięcie sprawy DSA (#42) w panelu admina.
 *
 * Sprawy DSA nie zamyka zmiana statusu: „Weź do analizy” (open → reviewing) jest zwykłym
 * krokiem, a „Podejmij decyzję” otwiera dialog z uzasadnieniem — rozstrzygnięcie (brak działań /
 * wycofanie oferty / zawieszenie firmy), fakty, podstawa (regulamin albo prawo + wskazanie
 * postanowienia) i udział automatyzacji. Zapis = jedno RPC `admin_decide_report`: decyzja,
 * skutek, stan sprawy, historia, audyt i powiadomienia razem albo wcale (0095). Ograniczenie w
 * mocy można cofnąć („Cofnij ograniczenie”, wymagane uzasadnienie).
 *
 * Błędy przy polach (`aria-invalid` + `aria-describedby`, fokus na pierwszym błędzie), blokada
 * przycisków w trakcie zapisu (Invariant #11), fokus i komunikaty przez `AdminFeedbackProvider`.
 */

const DECISION_LABEL: Record<ModerationDecision, string> = {
  no_action: 'decisionNoAction',
  job_removed: 'decisionJobRemoved',
  company_suspended: 'decisionCompanySuspended',
};

const GROUND_LABEL: Record<string, string> = {
  terms: 'decisionGroundTerms',
  law: 'decisionGroundLaw',
};

const FIELD_ERROR_KEY: Record<ModerationFieldError, string> = {
  required: 'decisionErrorRequired',
  tooShort: 'decisionErrorTooShort',
  tooLong: 'decisionErrorTooLong',
  scope: 'decisionErrorScope',
};

const TEXT_INPUT =
  'block w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error';

export interface ModerationDecisionActionsProps {
  reportId: string;
  status: string;
  caseNumber: string;
  /** `job` | `company` — wyznacza dozwolone rozstrzygnięcia. */
  targetType: string;
  targetTypeLabel: string;
  targetLabel: string;
  reasonLabel: string;
  /** Decyzja w sprawie (po rozstrzygnięciu) — do cofnięcia ograniczenia. */
  decision: {
    id: string;
    reference: string;
    decision: string;
    restoredAt: string | null;
  } | null;
  className?: string;
}

type Dialog = 'decide' | 'restore' | null;

export function ModerationDecisionActions({
  reportId,
  status,
  caseNumber,
  targetType,
  targetTypeLabel,
  targetLabel,
  reasonLabel,
  decision,
  className,
}: ModerationDecisionActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [choice, setChoice] = React.useState<ModerationDecision | ''>('');
  const [facts, setFacts] = React.useState('');
  const [groundType, setGroundType] = React.useState('');
  const [groundReference, setGroundReference] = React.useState('');
  const [automated, setAutomated] = React.useState(false);
  const [restoreReason, setRestoreReason] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<ModerationField | 'reason', ModerationFieldError>>>({});

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const firstChoiceRef = React.useRef<HTMLInputElement | null>(null);
  const factsRef = React.useRef<HTMLTextAreaElement | null>(null);
  const firstGroundRef = React.useRef<HTMLInputElement | null>(null);
  const groundReferenceRef = React.useRef<HTMLInputElement | null>(null);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);

  const idBase = React.useId();
  const ids = {
    choice: `${idBase}-choice`,
    choiceError: `${idBase}-choice-error`,
    facts: `${idBase}-facts`,
    factsHint: `${idBase}-facts-hint`,
    factsError: `${idBase}-facts-error`,
    ground: `${idBase}-ground`,
    groundError: `${idBase}-ground-error`,
    groundReference: `${idBase}-ground-ref`,
    groundReferenceHint: `${idBase}-ground-ref-hint`,
    groundReferenceError: `${idBase}-ground-ref-error`,
    automated: `${idBase}-automated`,
    automatedHint: `${idBase}-automated-hint`,
    reason: `${idBase}-reason`,
    reasonHint: `${idBase}-reason-hint`,
    reasonError: `${idBase}-reason-error`,
  };

  const options = decisionsForTarget(targetType);
  const restricts = choice !== '' && decisionRestricts(choice);
  const canDecide = status === 'open' || status === 'reviewing';
  const canRestore =
    (status === 'resolved' || status === 'dismissed') &&
    decision !== null &&
    decisionRestricts(decision.decision) &&
    decision.restoredAt === null;

  // Fokus na polu z błędem — dopiero gdy zapis się skończył (w trakcie pola są zablokowane).
  const [focusTarget, setFocusTarget] = React.useState<ModerationField | 'reason' | null>(null);
  const focusField = (field: ModerationField | 'reason') => setFocusTarget(field);
  React.useEffect(() => {
    if (pending || !focusTarget) return;
    const target = {
      decision: firstChoiceRef,
      facts: factsRef,
      groundType: firstGroundRef,
      groundReference: groundReferenceRef,
      reason: reasonRef,
    }[focusTarget];
    target.current?.focus();
    setFocusTarget(null);
  }, [pending, focusTarget]);

  const open = (next: Exclude<Dialog, null>, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setErrors({});
    if (next === 'decide') {
      setChoice('');
      setFacts('');
      setGroundType('');
      setGroundReference('');
      setAutomated(false);
    } else {
      setRestoreReason('');
    }
    setDialog(next);
  };

  const cancel = React.useCallback(() => {
    setDialog(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const handleResult = (
    res: Awaited<ReturnType<typeof decideReport>>,
    successMessage: string,
  ) => {
    if (res.ok) {
      setDialog(null);
      feedback.succeed({ message: successMessage, focusKey: reportFocusKey(reportId) });
    } else if (res.field && res.fieldError) {
      setErrors({ [res.field]: res.fieldError });
      focusField(res.field);
    } else if (res.error === 'STALE_STATE' || res.error === 'INVALID_TRANSITION') {
      setDialog(null);
      feedback.succeed({
        message: tRoot(toUserMessageKey(res.error)),
        focusKey: reportFocusKey(reportId),
        tone: 'error',
      });
    } else {
      feedback.fail(tRoot(toUserMessageKey(res.error as ErrorCode)));
    }
  };

  const submitDecision = () => {
    if (pending) return;
    const input = {
      decision: choice,
      facts,
      groundType: restricts ? groundType : null,
      groundReference: restricts ? groundReference : null,
      automatedDetection: automated,
    };
    const invalid = moderationDecisionError(input, targetType);
    if (invalid) {
      setErrors({ [invalid.field]: invalid.error });
      focusField(invalid.field);
      return;
    }
    startTransition(async () => {
      try {
        handleResult(await decideReport(reportId, status, targetType, input), t('decisionSaved'));
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const submitRestore = () => {
    if (pending || !decision) return;
    const invalid = restoreReasonError(restoreReason);
    if (invalid) {
      setErrors({ reason: invalid });
      focusField('reason');
      return;
    }
    startTransition(async () => {
      try {
        handleResult(await restoreModeration(decision.id, restoreReason), t('restoreSaved'));
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const takeForReview = () => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await resolveReport(reportId, 'reviewing', status);
        if (res.ok) {
          feedback.succeed({ message: t('reportResolved'), focusKey: reportFocusKey(reportId) });
        } else if (res.error === 'STALE_STATE' || res.error === 'INVALID_TRANSITION') {
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: reportFocusKey(reportId),
            tone: 'error',
          });
        } else {
          feedback.fail(tRoot(toUserMessageKey(res.error)));
        }
      } catch {
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const errorText = (field: ModerationField | 'reason', min: number, max: number) => {
    const error = errors[field];
    return error ? t(FIELD_ERROR_KEY[error], { min, max }) : null;
  };

  if (!canDecide && !canRestore) {
    return <span className="text-xs text-muted-foreground">{t('noActions')}</span>;
  }

  const details = [
    { key: 'case', label: t('caseNumber'), value: caseNumber },
    { key: 'type', label: t('reportTargetType'), value: targetTypeLabel },
    { key: 'target', label: t('reportTarget'), value: targetLabel },
    { key: 'reason', label: t('reportReason'), value: reasonLabel },
  ];

  const choiceError = errorText('decision', 0, 0);
  const factsError = errorText('facts', MODERATION_FACTS_MIN, MODERATION_FACTS_MAX);
  const groundError = errorText('groundType', 0, 0);
  const groundReferenceError = errorText(
    'groundReference',
    MODERATION_GROUND_REFERENCE_MIN,
    MODERATION_GROUND_REFERENCE_MAX,
  );
  const reasonError = errorText('reason', MODERATION_RESTORE_REASON_MIN, MODERATION_RESTORE_REASON_MAX);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {status === 'open' ? (
        <button
          type="button"
          disabled={pending}
          aria-busy={(pending && dialog === null) || undefined}
          onClick={takeForReview}
          className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.neutral)}
        >
          {t('actionReview')}
        </button>
      ) : null}
      {canDecide ? (
        <button
          type="button"
          disabled={pending}
          aria-haspopup="dialog"
          onClick={(event) => open('decide', event.currentTarget)}
          className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.warning)}
        >
          {t('actionDecide')}
        </button>
      ) : null}
      {canRestore ? (
        <button
          type="button"
          disabled={pending}
          aria-haspopup="dialog"
          onClick={(event) => open('restore', event.currentTarget)}
          className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.neutral)}
        >
          {t('actionRestore')}
        </button>
      ) : null}

      {dialog === 'decide' ? (
        <AdminConfirmDialog
          title={t('decisionDialogTitle', { caseNumber })}
          description={t('decisionDialogHint')}
          details={details}
          confirmLabel={t('decisionConfirm')}
          tone={restricts ? 'error' : 'neutral'}
          pending={pending}
          onConfirm={submitDecision}
          onCancel={cancel}
          initialFocusRef={firstChoiceRef}
        >
          <div className="mt-4 space-y-4">
            <fieldset
              aria-describedby={choiceError ? ids.choiceError : undefined}
            >
              <legend className="text-sm font-medium text-foreground">{t('decisionLabel')}</legend>
              <div className="mt-2 space-y-2">
                {options.map((value, index) => (
                  <label key={value} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                    <input
                      ref={index === 0 ? firstChoiceRef : undefined}
                      type="radio"
                      name={ids.choice}
                      value={value}
                      checked={choice === value}
                      disabled={pending}
                      onChange={() => {
                        setChoice(value);
                        setErrors((prev) => ({ ...prev, decision: undefined }));
                      }}
                      className="mt-0.5 size-4 accent-foreground"
                    />
                    <span>{t(DECISION_LABEL[value])}</span>
                  </label>
                ))}
              </div>
              {choiceError ? (
                <p id={ids.choiceError} className="mt-1 text-sm font-medium text-error-text">
                  {choiceError}
                </p>
              ) : null}
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor={ids.facts} className="block text-sm font-medium text-foreground">
                {t('decisionFactsLabel')}
              </label>
              <p id={ids.factsHint} className="text-xs text-muted-foreground">
                {t('decisionFactsHint', { min: MODERATION_FACTS_MIN, max: MODERATION_FACTS_MAX })}
              </p>
              <textarea
                ref={factsRef}
                id={ids.facts}
                name="facts"
                rows={4}
                required
                maxLength={MODERATION_FACTS_MAX}
                value={facts}
                disabled={pending}
                aria-invalid={factsError ? true : undefined}
                aria-describedby={factsError ? `${ids.factsHint} ${ids.factsError}` : ids.factsHint}
                onChange={(event) => {
                  setFacts(event.target.value);
                  setErrors((prev) => ({ ...prev, facts: undefined }));
                }}
                className={TEXT_INPUT}
              />
              {factsError ? (
                <p id={ids.factsError} className="text-sm font-medium text-error-text">
                  {factsError}
                </p>
              ) : null}
            </div>

            {restricts ? (
              <>
                <fieldset
                  aria-describedby={groundError ? ids.groundError : undefined}
                >
                  <legend className="text-sm font-medium text-foreground">{t('decisionGroundLabel')}</legend>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                    {MODERATION_GROUNDS.map((value, index) => (
                      <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                        <input
                          ref={index === 0 ? firstGroundRef : undefined}
                          type="radio"
                          name={ids.ground}
                          value={value}
                          checked={groundType === value}
                          disabled={pending}
                          onChange={() => {
                            setGroundType(value);
                            setErrors((prev) => ({ ...prev, groundType: undefined }));
                          }}
                          className="size-4 accent-foreground"
                        />
                        <span>{t(GROUND_LABEL[value] ?? 'decisionGroundTerms')}</span>
                      </label>
                    ))}
                  </div>
                  {groundError ? (
                    <p id={ids.groundError} className="mt-1 text-sm font-medium text-error-text">
                      {groundError}
                    </p>
                  ) : null}
                </fieldset>

                <div className="space-y-1.5">
                  <label htmlFor={ids.groundReference} className="block text-sm font-medium text-foreground">
                    {t('decisionGroundReferenceLabel')}
                  </label>
                  <p id={ids.groundReferenceHint} className="text-xs text-muted-foreground">
                    {t('decisionGroundReferenceHint', {
                      min: MODERATION_GROUND_REFERENCE_MIN,
                      max: MODERATION_GROUND_REFERENCE_MAX,
                    })}
                  </p>
                  <input
                    ref={groundReferenceRef}
                    id={ids.groundReference}
                    name="groundReference"
                    type="text"
                    required
                    maxLength={MODERATION_GROUND_REFERENCE_MAX}
                    value={groundReference}
                    disabled={pending}
                    aria-invalid={groundReferenceError ? true : undefined}
                    aria-describedby={
                      groundReferenceError
                        ? `${ids.groundReferenceHint} ${ids.groundReferenceError}`
                        : ids.groundReferenceHint
                    }
                    onChange={(event) => {
                      setGroundReference(event.target.value);
                      setErrors((prev) => ({ ...prev, groundReference: undefined }));
                    }}
                    className={cn(TEXT_INPUT, 'min-h-11')}
                  />
                  {groundReferenceError ? (
                    <p id={ids.groundReferenceError} className="text-sm font-medium text-error-text">
                      {groundReferenceError}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="flex items-start gap-2">
              <input
                id={ids.automated}
                type="checkbox"
                checked={automated}
                disabled={pending}
                aria-describedby={ids.automatedHint}
                onChange={(event) => setAutomated(event.target.checked)}
                className="mt-1 size-4 accent-foreground"
              />
              <div>
                <label htmlFor={ids.automated} className="text-sm font-medium text-foreground">
                  {t('decisionAutomatedLabel')}
                </label>
                <p id={ids.automatedHint} className="text-xs text-muted-foreground">
                  {t('decisionAutomatedHint')}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t(restricts ? 'decisionNotifyRestrict' : 'decisionNotifyNoAction')}
          </p>
        </AdminConfirmDialog>
      ) : null}

      {dialog === 'restore' && decision ? (
        <AdminConfirmDialog
          title={t('restoreDialogTitle', { reference: decision.reference })}
          description={t('restoreDialogHint')}
          details={[
            ...details,
            {
              key: 'decision',
              label: t('decisionLabel'),
              value: t(DECISION_LABEL[decision.decision as ModerationDecision] ?? 'decisionNoAction'),
            },
          ]}
          confirmLabel={t('actionRestore')}
          tone="neutral"
          pending={pending}
          onConfirm={submitRestore}
          onCancel={cancel}
          initialFocusRef={reasonRef}
        >
          <div className="mt-4 space-y-1.5">
            <label htmlFor={ids.reason} className="block text-sm font-medium text-foreground">
              {t('restoreReasonLabel')}
            </label>
            <p id={ids.reasonHint} className="text-xs text-muted-foreground">
              {t('restoreReasonHint', {
                min: MODERATION_RESTORE_REASON_MIN,
                max: MODERATION_RESTORE_REASON_MAX,
              })}
            </p>
            <textarea
              ref={reasonRef}
              id={ids.reason}
              name="reason"
              rows={4}
              required
              maxLength={MODERATION_RESTORE_REASON_MAX}
              value={restoreReason}
              disabled={pending}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${ids.reasonHint} ${ids.reasonError}` : ids.reasonHint}
              onChange={(event) => {
                setRestoreReason(event.target.value);
                setErrors((prev) => ({ ...prev, reason: undefined }));
              }}
              className={TEXT_INPUT}
            />
            {reasonError ? (
              <p id={ids.reasonError} className="text-sm font-medium text-error-text">
                {reasonError}
              </p>
            ) : null}
          </div>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
