'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { createBreachIncident, updateBreachIncident } from '@/lib/actions/breaches';
import {
  BREACH_AUTHORITY_DECISIONS,
  BREACH_AUTHORITY_KEY,
  BREACH_CATEGORY_KEY,
  BREACH_DATA_CATEGORIES,
  BREACH_FIELD_ERROR_KEY,
  BREACH_FIELD_LABEL_KEY,
  BREACH_FIELDS,
  BREACH_KIND_KEY,
  BREACH_KINDS,
  BREACH_LIMITS,
  BREACH_RISK_KEY,
  BREACH_RISK_LEVELS,
  BREACH_SUBJECTS_DECISIONS,
  BREACH_SUBJECTS_KEY,
  breachFormErrors,
  type BreachField,
  type BreachForm,
  type BreachFormErrors,
} from '@/lib/admin/breach';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { appLocalInputToUtc, utcToAppLocalInput } from '@/lib/datetime';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  BTN_PRIMARY,
  CHECK_ROW,
  CHECKBOX,
  FORM_CONTROL,
  FORM_ERROR,
  FORM_FIELD,
  FORM_HINT,
  FORM_LABEL_TEXT,
  PANEL,
  PANEL_H2,
  PANEL_P,
} from '@/components/admin/admin-styles';
import { useAdminFeedback } from '@/components/admin/AdminFeedback';

/**
 * BreachIncidentForm — wpis rejestru incydentów i naruszeń danych osobowych (#490).
 *
 * Sekcje: zdarzenie (rodzaj, opis, czas stwierdzenia — od niego liczy się 72 h), zakres
 * (kategorie danych, liczba osób), ocena ryzyka, decyzja o zgłoszeniu do organu (art. 33),
 * decyzja o zawiadomieniu osób (art. 34), działania. Daty wpisuje się w czasie Europe/Brussels
 * (`datetime-local`), do akcji trafiają jako ISO UTC.
 *
 * Walidacja jak w bazie (`breachFormErrors`), błędy przy polach (`aria-invalid` +
 * `aria-describedby`, fokus na pierwszym błędzie), blokada przycisku w trakcie zapisu i jeden
 * klucz idempotencji na operację (Invariant #11). Edycja wysyła wersję widzianą przez admina
 * (konflikt → `STALE_STATE`). Zamknięty wpis: tylko podgląd.
 */

type DateField = 'detectedAt' | 'occurredAt' | 'authorityNotifiedAt' | 'subjectsNotifiedAt';

const TEXTAREA_MAX: Partial<Record<BreachField, number>> = {
  description: BREACH_LIMITS.description,
  riskAssessment: BREACH_LIMITS.riskAssessment,
  authorityDecisionReason: BREACH_LIMITS.authorityDecisionReason,
  authorityDelayReason: BREACH_LIMITS.authorityDelayReason,
  subjectsDecisionReason: BREACH_LIMITS.subjectsDecisionReason,
  actionsTaken: BREACH_LIMITS.actionsTaken,
};

/** Podpowiedzi pól (klucz i18n) — pola bez podpowiedzi pomijamy. */
const HINT_KEY: Partial<Record<BreachField, string>> = {
  kind: 'breachHintKind',
  description: 'breachHintDescription',
  detectedAt: 'breachHintDetectedAt',
  occurredAt: 'breachHintOccurredAt',
  affectedCount: 'breachHintAffectedCount',
  riskAssessment: 'breachHintRiskAssessment',
  authorityDecisionReason: 'breachHintDecisionReason',
  authorityDelayReason: 'breachHintDelayReason',
  subjectsDecisionReason: 'breachHintDecisionReason',
  actionsTaken: 'breachHintActionsTaken',
};

type LocalForm = Omit<BreachForm, DateField> & Record<DateField, string>;

function toLocal(form: BreachForm): LocalForm {
  return {
    ...form,
    detectedAt: utcToAppLocalInput(form.detectedAt),
    occurredAt: utcToAppLocalInput(form.occurredAt),
    authorityNotifiedAt: utcToAppLocalInput(form.authorityNotifiedAt),
    subjectsNotifiedAt: utcToAppLocalInput(form.subjectsNotifiedAt),
  };
}

/** Pole lokalne → ISO; wpis, którego nie da się odczytać, zostaje jako błąd formatu. */
function toIso(value: string): string {
  if (value.trim().length === 0) return '';
  return appLocalInputToUtc(value) ?? 'invalid';
}

function toForm(local: LocalForm): BreachForm {
  return {
    ...local,
    detectedAt: toIso(local.detectedAt),
    occurredAt: toIso(local.occurredAt),
    authorityNotifiedAt: toIso(local.authorityNotifiedAt),
    subjectsNotifiedAt: toIso(local.subjectsNotifiedAt),
  };
}

function newKey(): string {
  return crypto.randomUUID();
}

export interface BreachIncidentFormProps {
  mode: 'create' | 'edit';
  initial: BreachForm;
  incidentId?: string;
  version?: number;
  readOnly?: boolean;
}

export function BreachIncidentForm({
  mode,
  initial,
  incidentId,
  version,
  readOnly = false,
}: BreachIncidentFormProps): React.JSX.Element {
  const t = useTranslations('admin');
  const tRoot = useTranslations();
  const router = useRouter();
  const feedback = useAdminFeedback();
  const [pending, startTransition] = React.useTransition();
  const [values, setValues] = React.useState<LocalForm>(() => toLocal(initial));
  const [errors, setErrors] = React.useState<BreachFormErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const clientKey = React.useRef<string>('');
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const idBase = React.useId();
  const disabled = pending || readOnly;

  const idOf = (field: string) => `${idBase}-${field}`;

  const set = <K extends keyof LocalForm>(field: K, value: LocalForm[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field as BreachField]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field as BreachField];
        return next;
      });
    }
  };

  const focusFirstError = (found: BreachFormErrors) => {
    const first = BREACH_FIELDS.find((field) => found[field]);
    if (!first) return;
    window.setTimeout(() => {
      const target = formRef.current?.querySelector<HTMLElement>(`[data-breach-field="${first}"]`);
      target?.focus();
    }, 0);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    const form = toForm(values);
    const found = breachFormErrors(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFormError(t('breachFormHasErrors'));
      focusFirstError(found);
      return;
    }
    setErrors({});
    setFormError(null);
    if (!clientKey.current) clientKey.current = newKey();
    startTransition(async () => {
      try {
        if (mode === 'create') {
          const res = await createBreachIncident(clientKey.current, form);
          if (res.ok) {
            if (res.demo || !res.id) {
              clientKey.current = '';
              setFormError(t('breachDemoNotSaved'));
              return;
            }
            router.push(`/admin/naruszenia/${res.id}`);
            return;
          }
          handleError(res);
          return;
        }
        const res = await updateBreachIncident(incidentId ?? '', version ?? 0, form);
        if (res.ok) {
          feedback.succeed({
            message: res.demo ? t('breachDemoNotSaved') : t('breachSaved'),
            focusKey: ADMIN_PAGE_HEADING_FOCUS,
          });
          return;
        }
        handleError(res);
      } catch {
        // Sieć: ten sam klucz przy ponowieniu (create) — bez duplikatu.
        setFormError(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  const handleError = (res: {
    error: ErrorCode;
    fields?: BreachFormErrors;
    problem?: string;
  }) => {
    if (res.fields && Object.keys(res.fields).length > 0) {
      setErrors(res.fields);
      setFormError(t('breachFormHasErrors'));
      focusFirstError(res.fields);
      return;
    }
    if (res.problem === 'closed') {
      setFormError(t('breachErrorClosed'));
      return;
    }
    setFormError(
      res.error === 'STALE_STATE' ? t('breachErrorStale') : tRoot(toUserMessageKey(res.error)),
    );
  };

  const describedBy = (field: BreachField) =>
    [HINT_KEY[field] ? `${idOf(field)}-hint` : null, errors[field] ? `${idOf(field)}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const fieldError = (field: BreachField) => {
    const error = errors[field];
    if (!error) return null;
    return (
      <p id={`${idOf(field)}-error`} className={FORM_ERROR}>
        {t(BREACH_FIELD_ERROR_KEY[error], { max: TEXTAREA_MAX[field] ?? BREACH_LIMITS.title })}
      </p>
    );
  };

  const hint = (field: BreachField) => {
    const key = HINT_KEY[field];
    return key ? (
      <p id={`${idOf(field)}-hint`} className={FORM_HINT}>
        {t(key)}
      </p>
    ) : null;
  };

  const label = (field: BreachField, required = false) => (
    <label htmlFor={idOf(field)} className={FORM_LABEL_TEXT}>
      {t(BREACH_FIELD_LABEL_KEY[field])}
      {required ? <span className="text-muted-foreground"> {t('breachRequiredMark')}</span> : null}
    </label>
  );

  const control = (field: BreachField) => ({
    id: idOf(field),
    'data-breach-field': field,
    disabled,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': describedBy(field),
    className: FORM_CONTROL,
  });

  const textField = (field: 'title' | 'authorityReference', required = false) => (
    <div className={FORM_FIELD}>
      {label(field, required)}
      {hint(field)}
      <input
        {...control(field)}
        type="text"
        value={values[field]}
        maxLength={field === 'title' ? BREACH_LIMITS.title : BREACH_LIMITS.authorityReference}
        onChange={(e) => set(field, e.target.value)}
      />
      {fieldError(field)}
    </div>
  );

  const areaField = (
    field:
      | 'description'
      | 'riskAssessment'
      | 'authorityDecisionReason'
      | 'authorityDelayReason'
      | 'subjectsDecisionReason'
      | 'actionsTaken',
    required = false,
  ) => (
    <div className={FORM_FIELD}>
      {label(field, required)}
      {hint(field)}
      <textarea
        {...control(field)}
        rows={field === 'description' || field === 'actionsTaken' ? 5 : 3}
        value={values[field]}
        maxLength={TEXTAREA_MAX[field]}
        onChange={(e) => set(field, e.target.value)}
      />
      {fieldError(field)}
    </div>
  );

  const dateField = (field: DateField, required = false) => (
    <div className={FORM_FIELD}>
      {label(field, required)}
      {hint(field)}
      <input
        {...control(field)}
        type="datetime-local"
        value={values[field]}
        onChange={(e) => set(field, e.target.value)}
      />
      {fieldError(field)}
    </div>
  );

  const selectField = (
    field: 'kind' | 'riskLevel' | 'authorityDecision' | 'subjectsDecision',
    options: readonly string[],
    keys: Record<string, string>,
  ) => (
    <div className={FORM_FIELD}>
      {label(field)}
      {hint(field)}
      <select {...control(field)} value={values[field]} onChange={(e) => set(field, e.target.value)}>
        {options.map((value) => (
          <option key={value} value={value}>
            {t(keys[value] ?? 'statusUnknown')}
          </option>
        ))}
      </select>
      {fieldError(field)}
    </div>
  );

  const section = (id: string, title: string, intro: string | null, children: React.ReactNode) => (
    <section aria-labelledby={`${idBase}-${id}`} className={PANEL}>
      <h2 id={`${idBase}-${id}`} className={PANEL_H2}>
        {title}
      </h2>
      {intro ? <p className={cn(PANEL_P, 'mt-1.5')}>{intro}</p> : null}
      <div className="mt-5 grid min-w-0 gap-5">{children}</div>
    </section>
  );

  const categoriesError = errors.dataCategories;

  return (
    <form ref={formRef} noValidate onSubmit={submit} aria-busy={pending || undefined} className="min-w-0 space-y-[22px]">
      {readOnly ? <p className={PANEL_P}>{t('breachReadOnlyHint')}</p> : null}

      {section('event', t('breachSectionEvent'), null, (
        <>
          {selectField('kind', BREACH_KINDS, BREACH_KIND_KEY)}
          {textField('title', true)}
          {areaField('description', true)}
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            {dateField('detectedAt', true)}
            {dateField('occurredAt')}
          </div>
        </>
      ))}

      {section('scope', t('breachSectionScope'), t('breachSectionScopeHint'), (
        <>
          <fieldset
            className="min-w-0"
            aria-describedby={categoriesError ? `${idOf('dataCategories')}-error` : undefined}
          >
            <legend className={FORM_LABEL_TEXT}>{t(BREACH_FIELD_LABEL_KEY.dataCategories)}</legend>
            <div className="mt-2 grid min-w-0 gap-x-5 sm:grid-cols-2">
              {BREACH_DATA_CATEGORIES.map((category, index) => (
                <label key={category} className={cn(CHECK_ROW, 'my-2')}>
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    disabled={disabled}
                    data-breach-field={index === 0 ? 'dataCategories' : undefined}
                    checked={values.dataCategories.includes(category)}
                    onChange={(e) =>
                      set(
                        'dataCategories',
                        e.target.checked
                          ? [...values.dataCategories, category]
                          : values.dataCategories.filter((c) => c !== category),
                      )
                    }
                  />
                  {t(BREACH_CATEGORY_KEY[category])}
                </label>
              ))}
            </div>
            {fieldError('dataCategories')}
          </fieldset>
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <div className={FORM_FIELD}>
              {label('affectedCount')}
              {hint('affectedCount')}
              <input
                {...control('affectedCount')}
                type="text"
                inputMode="numeric"
                value={values.affectedCount}
                maxLength={9}
                onChange={(e) => set('affectedCount', e.target.value)}
              />
              {fieldError('affectedCount')}
            </div>
            <label className={cn(CHECK_ROW, 'self-end')}>
              <input
                type="checkbox"
                className={CHECKBOX}
                disabled={disabled}
                checked={values.affectedCountEstimated}
                onChange={(e) => set('affectedCountEstimated', e.target.checked)}
              />
              {t(BREACH_FIELD_LABEL_KEY.affectedCountEstimated)}
            </label>
          </div>
        </>
      ))}

      {section('risk', t('breachSectionRisk'), t('breachSectionRiskHint'), (
        <>
          {selectField('riskLevel', BREACH_RISK_LEVELS, BREACH_RISK_KEY)}
          {areaField('riskAssessment', values.riskLevel !== 'not_assessed')}
        </>
      ))}

      {section('authority', t('breachSectionAuthority'), t('breachSectionAuthorityHint'), (
        <>
          {selectField('authorityDecision', BREACH_AUTHORITY_DECISIONS, BREACH_AUTHORITY_KEY)}
          {areaField('authorityDecisionReason', values.authorityDecision !== 'pending')}
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            {dateField('authorityNotifiedAt')}
            {textField('authorityReference')}
          </div>
          {areaField('authorityDelayReason')}
        </>
      ))}

      {section('subjects', t('breachSectionSubjects'), t('breachSectionSubjectsHint'), (
        <>
          {selectField('subjectsDecision', BREACH_SUBJECTS_DECISIONS, BREACH_SUBJECTS_KEY)}
          {areaField('subjectsDecisionReason', values.subjectsDecision !== 'pending')}
          {dateField('subjectsNotifiedAt')}
        </>
      ))}

      {section('actions', t('breachSectionActions'), null, areaField('actionsTaken'))}

      <div role="alert" className="min-h-0">
        {formError ? <p className={cn(FORM_ERROR, 'font-semibold')}>{formError}</p> : null}
      </div>

      {readOnly ? null : (
        <button type="submit" disabled={pending} className={BTN_PRIMARY}>
          {pending ? t('confirmSaving') : mode === 'create' ? t('breachCreateSubmit') : t('breachSaveSubmit')}
        </button>
      )}
    </form>
  );
}
