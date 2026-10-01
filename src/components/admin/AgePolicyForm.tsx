'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { setCandidateMinAge } from '@/lib/actions/admin-age-policy';
import { AGE_POLICY_REASON_MAX, agePolicyReasonError } from '@/lib/admin/age-policy';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { CANDIDATE_ADULT_AGE, CANDIDATE_MIN_AGE_LOWEST, isCandidateAgeBand } from '@/lib/age-policy/constants';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  CHECKBOX,
  CHECK_ROW,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_LABEL_TEXT,
  PANEL,
  PANEL_H2,
  PANEL_P,
} from '@/components/admin/admin-styles';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * AgePolicyForm — zmiana progu wieku konta kandydata (#492, `/admin/ustawienia`).
 *
 * Wybór 16/18 (jedyne dozwolone wartości, jak CHECK w bazie) i uzasadnienie (ZAWSZE wymagane,
 * limit jak w bazie). Formularz NIE ustala statusu „zatwierdzone przez właściciela” (#639,
 * migracja 0946): zmiana administratora zawsze zapisuje wartość roboczą, a zatwierdza ją tylko
 * właściciel drogą operatorską — dialog pokazuje to jako „status po zapisie”. Kliknięcie „Zapisz” NIE zmienia
 * progu od razu: otwiera dialog potwierdzenia z przejściem „obecny → nowy próg” (jak zmiana
 * statusu firmy, #310) — dopiero potwierdzenie woła Server Action.
 *
 * Podniesienie progu ukrywa od razu profile kandydatów z niższą deklaracją wieku (RPC to robi
 * samo, `#576`) — po sukcesie komunikat wspomina liczbę ukrytych profili, gdy > 0.
 */

const AGE_OPTIONS = [CANDIDATE_MIN_AGE_LOWEST, CANDIDATE_ADULT_AGE] as const;

export interface AgePolicyFormProps {
  minAge: number;
  /** Znacznik ostatniej zmiany progu widziany przez admina (CAS, #1102); `null` = brak zmiany. */
  updatedAt: string | null;
}

export function AgePolicyForm({ minAge, updatedAt }: AgePolicyFormProps): React.JSX.Element {
  const router = useRouter();
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const feedback = useAdminFeedback();

  const [pending, startTransition] = React.useTransition();
  const [selectedAge, setSelectedAge] = React.useState<number>(isCandidateAgeBand(minAge) ? minAge : CANDIDATE_ADULT_AGE);
  const [reasonValue, setReasonValue] = React.useState('');
  const [reasonError, setReasonError] = React.useState<'required' | 'tooLong' | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const submitRef = React.useRef<HTMLButtonElement | null>(null);
  const idBase = React.useId();
  const legendId = `${idBase}-legend`;
  const reasonId = `${idBase}-reason`;
  const reasonHintId = `${idBase}-reason-hint`;
  const reasonErrorId = `${idBase}-reason-error`;

  const ageLabel = (age: number) => (age === CANDIDATE_ADULT_AGE ? t('agePolicyOption18') : t('agePolicyOption16'));

  const openConfirm = () => {
    const localError = agePolicyReasonError(reasonValue);
    if (localError) {
      setReasonError(localError);
      reasonRef.current?.focus();
      return;
    }
    setConfirming(true);
  };

  const cancel = React.useCallback(() => {
    setConfirming(false);
    window.setTimeout(() => submitRef.current?.focus(), 0);
  }, []);

  const submit = () => {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await setCandidateMinAge(selectedAge, reasonValue, updatedAt);
        if (!res.ok && res.field === 'reason') {
          setConfirming(false);
          setReasonError(res.reason ?? 'required');
          window.setTimeout(() => reasonRef.current?.focus(), 0);
        } else if (res.ok) {
          setConfirming(false);
          setReasonValue('');
          setReasonError(null);
          feedback.succeed({
            message:
              res.hiddenProfiles && res.hiddenProfiles > 0
                ? t('agePolicySuccessHidden', { count: res.hiddenProfiles })
                : t('agePolicySuccess'),
            focusKey: ADMIN_PAGE_HEADING_FOCUS,
          });
        } else if (res.error === 'STALE_STATE') {
          // Próg zmienił inny administrator: pokaż aktualny stan i nie nadpisuj po cichu (#1102).
          setConfirming(false);
          feedback.fail(t('agePolicyStale'));
          router.refresh();
        } else {
          setConfirming(false);
          feedback.fail(tRoot(toUserMessageKey(res.error as ErrorCode)));
        }
      } catch {
        setConfirming(false);
        feedback.fail(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  return (
    <section className={PANEL}>
      <h2 className={PANEL_H2}>{t('agePolicyFormTitle')}</h2>
      <p className={cn(PANEL_P, 'mt-1')}>{t('agePolicyFormHint')}</p>

      <fieldset className="mt-4 space-y-2" aria-labelledby={legendId}>
        <legend id={legendId} className={FORM_LABEL_TEXT}>
          {t('agePolicyFieldLegend')}
        </legend>
        <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby={legendId}>
          {AGE_OPTIONS.map((age) => {
            const optionId = `${idBase}-age-${age}`;
            return (
              <label key={age} htmlFor={optionId} className={CHECK_ROW}>
                <input
                  id={optionId}
                  type="radio"
                  name={`${idBase}-age`}
                  value={age}
                  checked={selectedAge === age}
                  disabled={pending}
                  onChange={() => setSelectedAge(age)}
                  className={CHECKBOX}
                />
                {ageLabel(age)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className={cn(FORM_HINT, 'mt-3')}>{t('agePolicyConfirmedHint')}</p>

      <div className={cn(FORM_FIELD, 'mt-4')}>
        <label htmlFor={reasonId} className={FORM_LABEL_TEXT}>
          {t('agePolicyReasonLabel')}
        </label>
        <p id={reasonHintId} className={FORM_HINT}>
          {t('agePolicyReasonHint', { max: AGE_POLICY_REASON_MAX })}
        </p>
        <textarea
          ref={reasonRef}
          id={reasonId}
          name="reason"
          rows={4}
          required
          maxLength={AGE_POLICY_REASON_MAX}
          value={reasonValue}
          disabled={pending}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${reasonHintId} ${reasonErrorId}` : reasonHintId}
          onChange={(event) => {
            setReasonValue(event.target.value);
            if (reasonError) setReasonError(null);
          }}
          className="block w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-error"
        />
        {reasonError ? (
          <p id={reasonErrorId} className={FORM_ERROR}>
            {t(reasonError === 'tooLong' ? 'reasonTooLong' : 'reasonRequired', { max: AGE_POLICY_REASON_MAX })}
          </p>
        ) : null}
      </div>

      <button
        ref={submitRef}
        type="button"
        disabled={pending}
        aria-haspopup="dialog"
        onClick={openConfirm}
        className={cn(BTN_PRIMARY, 'mt-5')}
      >
        {t('agePolicySubmit')}
      </button>

      {confirming ? (
        <AdminConfirmDialog
          title={t('agePolicyConfirmTitle')}
          description={t('agePolicyConfirmDescription', {
            from: ageLabel(isCandidateAgeBand(minAge) ? minAge : CANDIDATE_ADULT_AGE),
            to: ageLabel(selectedAge),
          })}
          details={[
            { key: 'current', label: t('agePolicyCurrentLabel'), value: ageLabel(isCandidateAgeBand(minAge) ? minAge : CANDIDATE_ADULT_AGE) },
            { key: 'new', label: t('agePolicyNewLabel'), value: ageLabel(selectedAge) },
            { key: 'confirmed', label: t('agePolicyAfterSaveLabel'), value: t('agePolicyConfirmedNo') },
          ]}
          confirmLabel={t('agePolicySubmit')}
          tone={selectedAge > minAge ? 'warning' : 'neutral'}
          pending={pending}
          onConfirm={submit}
          onCancel={cancel}
        >
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground">{reasonValue}</p>
        </AdminConfirmDialog>
      ) : null}
    </section>
  );
}
