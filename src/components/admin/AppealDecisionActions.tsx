'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { decideAppeal } from '@/lib/actions/appeals';
import {
  APPEAL_REASONING_MAX,
  APPEAL_REASONING_MIN,
  appealDecisionError,
  appealNeedsRestriction,
  appealRestrictionsForTarget,
  type AppealDecisionField,
  type AppealOutcome,
} from '@/lib/admin/appeals';
import { appealFocusKey } from '@/lib/admin/focus';
import {
  MODERATION_GROUND_REFERENCE_MAX,
  MODERATION_GROUND_REFERENCE_MIN,
  MODERATION_GROUNDS,
  type ModerationFieldError,
} from '@/lib/admin/moderation';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  ADMIN_ACTION_TONE_CLASS,
  ADMIN_BUTTON_BASE,
  AdminConfirmDialog,
} from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * AppealDecisionActions — rozpatrzenie odwołania od decyzji moderacyjnej (DSA, #43).
 *
 * Wynik: utrzymanie decyzji albo uwzględnienie odwołania. Uwzględnienie odwołania autora cofa
 * ograniczenie; uwzględnienie odwołania zgłaszającego wymaga nowego ograniczenia z podstawą
 * (ponowne zastosowanie skutku). Uzasadnienie trafia do osoby odwołującej się. Zapis = jedno
 * RPC `admin_decide_appeal` (skutek, historia, audyt, powiadomienia razem albo wcale).
 * Autor decyzji nie rozpatruje odwołania, gdy jest inny administrator (`reviewerConflict`).
 */

const FIELD_ERROR_KEY: Record<ModerationFieldError, string> = {
  required: 'decisionErrorRequired',
  tooShort: 'decisionErrorTooShort',
  tooLong: 'decisionErrorTooLong',
  scope: 'decisionErrorScope',
};

const DECISION_LABEL: Record<string, string> = {
  job_removed: 'decisionJobRemoved',
  company_suspended: 'decisionCompanySuspended',
};

const GROUND_LABEL: Record<string, string> = {
  terms: 'decisionGroundTerms',
  law: 'decisionGroundLaw',
};

const TEXT_INPUT =
  'block w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error';

export interface AppealDecisionActionsProps {
  appealId: string;
  reference: string;
  role: 'author' | 'reporter';
  /** Cel sprawy (`job` | `company`) — dozwolone ograniczenia po odwołaniu zgłaszającego. */
  targetType: string;
  decisionReference: string;
  reviewerConflict: boolean;
}

export function AppealDecisionActions({
  appealId,
  reference,
  role,
  targetType,
  decisionReference,
  reviewerConflict,
}: AppealDecisionActionsProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState<AppealOutcome | ''>('');
  const [reasoning, setReasoning] = React.useState('');
  const [decision, setDecision] = React.useState('');
  const [groundType, setGroundType] = React.useState('');
  const [groundReference, setGroundReference] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<AppealDecisionField, ModerationFieldError>>>({});
  const [focusTarget, setFocusTarget] = React.useState<AppealDecisionField | null>(null);

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const outcomeRef = React.useRef<HTMLInputElement | null>(null);
  const reasoningRef = React.useRef<HTMLTextAreaElement | null>(null);
  const decisionRef = React.useRef<HTMLInputElement | null>(null);
  const groundRef = React.useRef<HTMLInputElement | null>(null);
  const groundReferenceRef = React.useRef<HTMLInputElement | null>(null);

  const idBase = React.useId();
  const ids = {
    outcome: `${idBase}-outcome`,
    outcomeError: `${idBase}-outcome-error`,
    reasoning: `${idBase}-reasoning`,
    reasoningHint: `${idBase}-reasoning-hint`,
    reasoningError: `${idBase}-reasoning-error`,
    decision: `${idBase}-decision`,
    decisionError: `${idBase}-decision-error`,
    ground: `${idBase}-ground`,
    groundError: `${idBase}-ground-error`,
    groundReference: `${idBase}-ground-ref`,
    groundReferenceError: `${idBase}-ground-ref-error`,
  };

  React.useEffect(() => {
    if (pending || !focusTarget) return;
    const target = {
      outcome: outcomeRef,
      reasoning: reasoningRef,
      decision: decisionRef,
      groundType: groundRef,
      groundReference: groundReferenceRef,
    }[focusTarget];
    target.current?.focus();
    setFocusTarget(null);
  }, [pending, focusTarget]);

  const restricts = outcome !== '' && appealNeedsRestriction(role, outcome);

  if (reviewerConflict) {
    return <p className="text-xs text-muted-foreground">{t('appealReviewerConflict')}</p>;
  }

  const cancel = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const submit = () => {
    if (pending) return;
    const input = {
      outcome,
      reasoning,
      decision: restricts ? decision : null,
      groundType: restricts ? groundType : null,
      groundReference: restricts ? groundReference : null,
    };
    const invalid = appealDecisionError(input, role, targetType);
    if (invalid) {
      setErrors({ [invalid.field]: invalid.error });
      setFocusTarget(invalid.field);
      return;
    }
    startTransition(async () => {
      try {
        const res = await decideAppeal(appealId, 'pending', role, targetType, input);
        if (res.ok) {
          setOpen(false);
          feedback.succeed({ message: t('appealSaved'), focusKey: appealFocusKey(appealId) });
        } else if (res.field && res.fieldError) {
          setErrors({ [res.field]: res.fieldError });
          setFocusTarget(res.field);
        } else if (res.error === 'STALE_STATE' || res.error === 'INVALID_TRANSITION') {
          setOpen(false);
          feedback.succeed({
            message: tRoot(toUserMessageKey(res.error)),
            focusKey: appealFocusKey(appealId),
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

  const errorText = (field: AppealDecisionField, min = 0, max = 0) => {
    const error = errors[field];
    return error ? t(FIELD_ERROR_KEY[error], { min, max }) : null;
  };
  const outcomeError = errorText('outcome');
  const reasoningError = errorText('reasoning', APPEAL_REASONING_MIN, APPEAL_REASONING_MAX);
  const decisionError = errorText('decision');
  const groundError = errorText('groundType');
  const groundReferenceError = errorText(
    'groundReference',
    MODERATION_GROUND_REFERENCE_MIN,
    MODERATION_GROUND_REFERENCE_MAX,
  );

  const outcomes: Array<{ value: AppealOutcome; label: string }> = [
    { value: 'upheld', label: t('appealOutcomeUpheld') },
    {
      value: 'reversed',
      label: t(role === 'author' ? 'appealOutcomeReversedAuthor' : 'appealOutcomeReversedReporter'),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          setErrors({});
          setOutcome('');
          setReasoning('');
          setDecision('');
          setGroundType('');
          setGroundReference('');
          setOpen(true);
        }}
        className={cn(ADMIN_BUTTON_BASE, 'border bg-card', ADMIN_ACTION_TONE_CLASS.warning)}
      >
        {t('appealActionDecide')}
      </button>

      {open ? (
        <AdminConfirmDialog
          title={t('appealDialogTitle', { reference })}
          description={t('appealDialogHint')}
          details={[
            { key: 'decision', label: t('appealOriginalDecisionLabel'), value: decisionReference },
            {
              key: 'role',
              label: t('appealRoleLabel'),
              value: t(role === 'author' ? 'appealRoleAuthor' : 'appealRoleReporter'),
            },
          ]}
          confirmLabel={t('appealConfirm')}
          tone={outcome === 'reversed' ? 'error' : 'neutral'}
          pending={pending}
          onConfirm={submit}
          onCancel={cancel}
          initialFocusRef={outcomeRef}
        >
          <div className="mt-4 space-y-4">
            <fieldset aria-describedby={outcomeError ? ids.outcomeError : undefined}>
              <legend className="text-sm font-medium text-foreground">{t('appealOutcomeLabel')}</legend>
              <div className="mt-2 space-y-2">
                {outcomes.map((option, index) => (
                  <label key={option.value} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                    <input
                      ref={index === 0 ? outcomeRef : undefined}
                      type="radio"
                      name={ids.outcome}
                      value={option.value}
                      checked={outcome === option.value}
                      disabled={pending}
                      onChange={() => {
                        setOutcome(option.value);
                        setErrors((prev) => ({ ...prev, outcome: undefined }));
                      }}
                      className="mt-0.5 size-4 accent-foreground"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              {outcomeError ? (
                <p id={ids.outcomeError} className="mt-1 text-sm font-medium text-error-text">
                  {outcomeError}
                </p>
              ) : null}
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor={ids.reasoning} className="block text-sm font-medium text-foreground">
                {t('appealReasoningLabel')}
              </label>
              <p id={ids.reasoningHint} className="text-xs text-muted-foreground">
                {t('appealReasoningHint', { min: APPEAL_REASONING_MIN, max: APPEAL_REASONING_MAX })}
              </p>
              <textarea
                ref={reasoningRef}
                id={ids.reasoning}
                rows={4}
                required
                maxLength={APPEAL_REASONING_MAX}
                value={reasoning}
                disabled={pending}
                aria-invalid={reasoningError ? true : undefined}
                aria-describedby={reasoningError ? `${ids.reasoningHint} ${ids.reasoningError}` : ids.reasoningHint}
                onChange={(event) => {
                  setReasoning(event.target.value);
                  setErrors((prev) => ({ ...prev, reasoning: undefined }));
                }}
                className={TEXT_INPUT}
              />
              {reasoningError ? (
                <p id={ids.reasoningError} className="text-sm font-medium text-error-text">
                  {reasoningError}
                </p>
              ) : null}
            </div>

            {restricts ? (
              <>
                <fieldset aria-describedby={decisionError ? ids.decisionError : undefined}>
                  <legend className="text-sm font-medium text-foreground">{t('appealNewDecisionLabel')}</legend>
                  <div className="mt-2 space-y-2">
                    {appealRestrictionsForTarget(targetType).map((value, index) => (
                      <label key={value} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                        <input
                          ref={index === 0 ? decisionRef : undefined}
                          type="radio"
                          name={ids.decision}
                          value={value}
                          checked={decision === value}
                          disabled={pending}
                          onChange={() => {
                            setDecision(value);
                            setErrors((prev) => ({ ...prev, decision: undefined }));
                          }}
                          className="mt-0.5 size-4 accent-foreground"
                        />
                        <span>{t(DECISION_LABEL[value] ?? 'decisionJobRemoved')}</span>
                      </label>
                    ))}
                  </div>
                  {decisionError ? (
                    <p id={ids.decisionError} className="mt-1 text-sm font-medium text-error-text">
                      {decisionError}
                    </p>
                  ) : null}
                </fieldset>

                <fieldset aria-describedby={groundError ? ids.groundError : undefined}>
                  <legend className="text-sm font-medium text-foreground">{t('decisionGroundLabel')}</legend>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                    {MODERATION_GROUNDS.map((value, index) => (
                      <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                        <input
                          ref={index === 0 ? groundRef : undefined}
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
                  <input
                    ref={groundReferenceRef}
                    id={ids.groundReference}
                    type="text"
                    required
                    maxLength={MODERATION_GROUND_REFERENCE_MAX}
                    value={groundReference}
                    disabled={pending}
                    aria-invalid={groundReferenceError ? true : undefined}
                    aria-describedby={groundReferenceError ? ids.groundReferenceError : undefined}
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
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('appealNotify')}</p>
        </AdminConfirmDialog>
      ) : null}
    </div>
  );
}
