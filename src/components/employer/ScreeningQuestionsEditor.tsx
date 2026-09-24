'use client';

import { cn } from '@/lib/utils';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { localeNames, routing, type Locale } from '@/i18n/routing';
import {
  localizedText,
  SCREENING_LIMITS,
  SCREENING_QUESTION_TYPES,
  type ScreeningQuestionDraft,
  type ScreeningQuestionType,
} from '@/lib/screening/questions';
import { screeningQuestionRisk, type ScreeningRiskCategory } from '@/lib/screening/risk';
import { SCREENING_RISK_CATEGORY_KEY, type ScreeningReviewNotice } from '@/lib/screening/review';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BTN_RESET,
  BTN_SECONDARY,
  BTN_SMALL,
  CHECKBOX,
  FORM_ERROR,
  FORM_FIELD,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  FORM_SELECT,
  FORM_WIDE,
  H3_EXTENDED,
  P_EXTENDED,
  PANEL,
} from '@/components/dashboard/panel-styles';

/**
 * Edytor pytań screeningowych w kreatorze oferty (#101): typ, „wymagane”, kolejność, treść
 * w języku oferty (wymagana) i tłumaczenia (opcjonalne). Zapis idzie razem z krokiem kreatora
 * (`save_job_draft`, replace-all) — w trybie edycji opublikowanej oferty pytania są tylko do
 * odczytu, bo baza zmienia je wyłącznie w szkicu.
 *
 * Błędy (klucze i18n) przychodzą z walidacji kroku jako mapa ścieżek:
 *   ''                  — lista (np. za dużo pytań)
 *   'i'                 — pytanie (typ)
 *   'i.prompt[.lang]'   — treść pytania
 *   'i.options'         — liczba opcji
 *   'i.options.j[.lang]'— opcja
 *
 * #497: pod treścią pytania, które detektor (`screeningQuestionRisk` — ten sam zestaw wzorców
 * co baza, 0099) uznał za mogące dotyczyć danych chronionych, widać informację, że przed
 * publikacją sprawdzi je zespół portalu. Po próbie publikacji `reviews` niesie stan przeglądu
 * z bazy (oczekuje / odrzucone z uzasadnieniem). Informacja nie blokuje zapisu szkicu —
 * publikację blokuje baza.
 */

const TYPE_LABEL_KEYS: Record<ScreeningQuestionType, string> = {
  yes_no: 'screeningTypeYesNo',
  single_choice: 'screeningTypeSingleChoice',
  date: 'screeningTypeDate',
  short_text: 'screeningTypeShortText',
};

/** Ścieżka błędu Zod (po `screeningQuestions`) → klucz mapy błędów edytora. */
export function screeningErrorKey(path: readonly (string | number)[]): string {
  const [index, field, a, b, c] = path;
  if (index === undefined) return '';
  if (field === 'prompt') return a === undefined ? `${index}.prompt` : `${index}.prompt.${a}`;
  if (field === 'options') {
    if (a === undefined) return `${index}.options`;
    return b === 'label' && c !== undefined ? `${index}.options.${a}.${c}` : `${index}.options.${a}`;
  }
  return String(index);
}

function fieldPromptId(index: number, locale: Locale, primary: Locale): string {
  return locale === primary ? `job-sq-${index}-prompt` : `job-sq-${index}-prompt-${locale}`;
}
function fieldOptionId(index: number, option: number, locale: Locale, primary: Locale): string {
  return locale === primary ? `job-sq-${index}-option-${option}` : `job-sq-${index}-option-${option}-${locale}`;
}

/** Id pola dla klucza błędu (fokus na pierwszym błędzie). */
export function screeningErrorFieldId(key: string, primary: Locale): string {
  if (key === '') return 'job-screeningQuestions';
  const [index, field, a, b] = key.split('.');
  const i = Number(index);
  if (field === 'prompt') {
    const locale = (a ?? primary) as Locale;
    return fieldPromptId(i, locale, primary);
  }
  if (field === 'options') {
    if (a === undefined) return `job-sq-${i}-add-option`;
    return fieldOptionId(i, Number(a), (b ?? primary) as Locale, primary);
  }
  return `job-sq-${i}-type`;
}

function emptyQuestion(): ScreeningQuestionDraft {
  return { type: 'yes_no', required: false, prompt: {}, options: [] };
}

export interface ScreeningQuestionsEditorProps {
  value: ScreeningQuestionDraft[];
  onChange: (next: ScreeningQuestionDraft[]) => void;
  contentLocale: Locale;
  readOnly: boolean;
  errors: Record<string, string>;
  /** Stan przeglądu pytań z ostatniej próby publikacji (#497); brak = tylko podpowiedź detektora. */
  reviews?: readonly ScreeningReviewNotice[];
}

export function ScreeningQuestionsEditor({
  value,
  onChange,
  contentLocale,
  readOnly,
  errors,
  reviews = [],
}: ScreeningQuestionsEditorProps): React.JSX.Element {
  const t = useTranslations('jobWizard');
  const tRoot = useTranslations();
  const tReview = useTranslations('screeningReview');
  const categoryList = (categories: readonly ScreeningRiskCategory[]) =>
    categories.map((category) => tReview(SCREENING_RISK_CATEGORY_KEY[category])).join(', ');
  const others = routing.locales.filter((locale) => locale !== contentLocale);
  const [openTranslations, setOpenTranslations] = React.useState<Record<number, boolean>>({});

  // Błąd w tłumaczeniu otwiera sekcję tłumaczeń tego pytania (inaczej pole byłoby niewidoczne).
  React.useEffect(() => {
    const withErrors = Object.keys(errors)
      .map((key) => key.split('.'))
      .filter((parts) => {
        const lang = parts[1] === 'prompt' ? parts[2] : parts[1] === 'options' ? parts[3] : undefined;
        return lang !== undefined && lang !== contentLocale;
      })
      .map((parts) => Number(parts[0]));
    if (withErrors.length === 0) return;
    setOpenTranslations((current) => {
      const next = { ...current };
      for (const index of withErrors) next[index] = true;
      return next;
    });
  }, [errors, contentLocale]);

  function update(index: number, patch: Partial<ScreeningQuestionDraft>): void {
    onChange(value.map((question, i) => (i === index ? { ...question, ...patch } : question)));
  }
  function move(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }
  function errorText(key: string): string | null {
    const message = errors[key];
    return message ? tRoot(message) : null;
  }
  function errorFor(...keys: string[]): { key: string; text: string } | null {
    for (const key of keys) {
      const text = errorText(key);
      if (text) return { key, text };
    }
    return null;
  }

  const listError = errorText('');
  const languageName = (locale: Locale) => localeNames[locale];

  return (
    // Prototyp nie ma edytora pytań — złożony z prymitywów `.extended h3`, `.panel`,
    // `.demo-form` i `.btn.secondary`; w siatce `.form-grid` zajmuje całą szerokość.
    <div id="job-screeningQuestions" className={cn(FORM_WIDE, 'min-w-0 space-y-4 border-t border-border pt-[27px]')}>
      <div className="space-y-1.5">
        <h3 className={`${H3_EXTENDED} mt-0`}>{t('screeningTitle')}</h3>
        <p className={P_EXTENDED}>
          {t('screeningHint', { max: SCREENING_LIMITS.questions })}
        </p>
        {readOnly ? (
          <p className={P_EXTENDED} data-testid="screening-read-only">
            {t('screeningReadOnly')}
          </p>
        ) : null}
      </div>

      {readOnly ? (
        value.length > 0 ? (
          <ol className={cn(P_EXTENDED, 'list-inside list-decimal space-y-1 break-words text-foreground')}>
            {value.map((question, index) => (
              <li key={index}>
                {localizedText(question.prompt, contentLocale, contentLocale)}{' '}
                <span className="text-muted-foreground">
                  ({t(TYPE_LABEL_KEYS[question.type])}
                  {question.required ? `, ${t('screeningRequiredBadge')}` : ''})
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={P_EXTENDED}>{t('screeningEmpty')}</p>
        )
      ) : (
        <>
          {value.map((question, index) => {
            const number = index + 1;
            const promptError = errorFor(`${index}.prompt`, `${index}.prompt.${contentLocale}`);
            const typeError = errorFor(String(index));
            const countError = errorFor(`${index}.options`);
            const promptId = fieldPromptId(index, contentLocale, contentLocale);
            const review = reviews.find((notice) => notice.index === index);
            const risk = review ? review.categories : screeningQuestionRisk(question);
            const riskId = `job-sq-${index}-risk`;
            const promptDescribedBy =
              [promptError ? `${promptId}-error` : null, risk.length > 0 ? riskId : null]
                .filter(Boolean)
                .join(' ') || undefined;
            return (
              <fieldset
                key={index}
                className={cn(PANEL, 'space-y-[18px]')}
                data-testid={`screening-question-${number}`}
              >
                <legend className={cn(FORM_LABEL_TEXT, 'px-1.5 text-[15px]')}>
                  {t('screeningQuestion', { n: number })}
                </legend>

                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
                  <div className={cn(FORM_FIELD, 'w-full sm:w-60')}>
                    <Label htmlFor={`job-sq-${index}-type`}>{t('screeningType')}</Label>
                    <Select
                      value={question.type}
                      onValueChange={(next) => {
                        const type = next as ScreeningQuestionType;
                        update(index, {
                          type,
                          options:
                            type === 'single_choice'
                              ? question.options.length >= SCREENING_LIMITS.optionsMin
                                ? question.options
                                : [{ label: {} }, { label: {} }]
                              : [],
                        });
                      }}
                    >
                      <SelectTrigger
                        className={FORM_SELECT}
                        id={`job-sq-${index}-type`}
                        aria-invalid={typeError ? true : undefined}
                        aria-describedby={typeError ? `job-sq-${index}-type-error` : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCREENING_QUESTION_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(TYPE_LABEL_KEYS[type])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {typeError ? (
                      <p id={`job-sq-${index}-type-error`} className={FORM_ERROR}>
                        {typeError.text}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex min-h-12 items-center gap-[9px]">
                    <Checkbox
                      id={`job-sq-${index}-required`}
                      checked={question.required}
                      onCheckedChange={(checked) => update(index, { required: checked === true })}
                      className={cn(CHECKBOX, 'rounded-[4px]')}
                    />
                    <Label htmlFor={`job-sq-${index}-required`} className="text-[13px] font-normal leading-[1.6]">
                      {t('screeningRequired')}
                    </Label>
                  </div>
                </div>

                <div className={FORM_FIELD}>
                  <Label htmlFor={promptId} className={FORM_LABEL_TEXT}>
                    {t('screeningPrompt', { language: languageName(contentLocale) })}
                  </Label>
                  <Input
                    className={FORM_INPUT}
                    id={promptId}
                    value={question.prompt[contentLocale] ?? ''}
                    placeholder={t('screeningPromptPlaceholder')}
                    onChange={(event) =>
                      update(index, { prompt: { ...question.prompt, [contentLocale]: event.target.value } })
                    }
                    aria-invalid={promptError ? true : undefined}
                    aria-describedby={promptDescribedBy}
                  />
                  {promptError ? (
                    <p id={`${promptId}-error`} className={FORM_ERROR}>
                      {promptError.text}
                    </p>
                  ) : null}
                  {risk.length > 0 ? (
                    <div
                      id={riskId}
                      data-testid={`screening-question-${number}-review`}
                      className="flex min-w-0 items-start gap-2 rounded-[12px] border border-warning/40 bg-warning/5 px-3 py-2.5 text-[13px] leading-[1.6] text-foreground"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                      <div className="min-w-0 space-y-1 break-words">
                        <p>
                          {review?.status === 'rejected'
                            ? t('screeningReviewRejected', { categories: categoryList(risk) })
                            : review
                              ? t('screeningReviewPending', { categories: categoryList(risk) })
                              : t('screeningRiskHint', { categories: categoryList(risk) })}
                        </p>
                        {review?.reason ? (
                          <p className="text-muted-foreground">
                            {t('screeningReviewReason', { reason: review.reason })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                {question.type === 'single_choice' ? (
                  <div className="space-y-[18px]">
                    {question.options.map((option, optionIndex) => {
                      const optionId = fieldOptionId(index, optionIndex, contentLocale, contentLocale);
                      const optionError = errorFor(
                        `${index}.options.${optionIndex}`,
                        `${index}.options.${optionIndex}.${contentLocale}`,
                      );
                      return (
                        <div key={optionIndex} className={FORM_FIELD}>
                          <Label htmlFor={optionId} className={FORM_LABEL_TEXT}>
                            {t('screeningOption', { n: optionIndex + 1, language: languageName(contentLocale) })}
                          </Label>
                          <div className="flex min-w-0 gap-3">
                            <Input
                              className={FORM_INPUT}
                              id={optionId}
                              value={option.label[contentLocale] ?? ''}
                              onChange={(event) =>
                                update(index, {
                                  options: question.options.map((o, j) =>
                                    j === optionIndex
                                      ? { label: { ...o.label, [contentLocale]: event.target.value } }
                                      : o,
                                  ),
                                })
                              }
                              aria-invalid={optionError ? true : undefined}
                              aria-describedby={optionError ? `${optionId}-error` : undefined}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className={`${BTN_SECONDARY} ${BTN_RESET} min-w-12 shrink-0 px-0`}
                              aria-label={t('screeningRemoveOption', { n: optionIndex + 1 })}
                              disabled={question.options.length <= SCREENING_LIMITS.optionsMin}
                              onClick={() =>
                                update(index, {
                                  options: question.options.filter((_, j) => j !== optionIndex),
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                          {optionError ? (
                            <p id={`${optionId}-error`} className={FORM_ERROR}>
                              {optionError.text}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                    <Button
                      id={`job-sq-${index}-add-option`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={`${BTN_SMALL} ${BTN_RESET} self-start`}
                      disabled={question.options.length >= SCREENING_LIMITS.optionsMax}
                      aria-describedby={countError ? `job-sq-${index}-options-error` : undefined}
                      onClick={() => update(index, { options: [...question.options, { label: {} }] })}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('screeningAddOption')}
                    </Button>
                    {countError ? (
                      <p id={`job-sq-${index}-options-error`} className={FORM_ERROR}>
                        {countError.text}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <details
                  open={openTranslations[index] === true}
                  onToggle={(event) => {
                    const open = (event.currentTarget as HTMLDetailsElement).open;
                    setOpenTranslations((current) => ({ ...current, [index]: open }));
                  }}
                  className="rounded-[14px] bg-soft px-4 py-1"
                >
                  <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-foreground">
                    {t('screeningTranslations')}
                  </summary>
                  <div className="mb-4 mt-2 space-y-[18px]">
                    {others.map((locale) => {
                      const id = fieldPromptId(index, locale, contentLocale);
                      const error = errorFor(`${index}.prompt.${locale}`);
                      return (
                        <div key={locale} className="space-y-[18px]">
                          <div className={FORM_FIELD}>
                            <Label htmlFor={id} className={FORM_LABEL_TEXT}>{t('screeningPrompt', { language: languageName(locale) })}</Label>
                            <Input
                              className={FORM_INPUT}
                              id={id}
                              value={question.prompt[locale] ?? ''}
                              onChange={(event) =>
                                update(index, { prompt: { ...question.prompt, [locale]: event.target.value } })
                              }
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `${id}-error` : undefined}
                            />
                            {error ? (
                              <p id={`${id}-error`} className={FORM_ERROR}>
                                {error.text}
                              </p>
                            ) : null}
                          </div>
                          {question.type === 'single_choice'
                            ? question.options.map((option, optionIndex) => {
                                const optionId = fieldOptionId(index, optionIndex, locale, contentLocale);
                                const optionError = errorFor(`${index}.options.${optionIndex}.${locale}`);
                                return (
                                  <div key={optionIndex} className={cn(FORM_FIELD, 'pl-3')}>
                                    <Label htmlFor={optionId} className={FORM_LABEL_TEXT}>
                                      {t('screeningOption', { n: optionIndex + 1, language: languageName(locale) })}
                                    </Label>
                                    <Input
                                      className={FORM_INPUT}
                                      id={optionId}
                                      value={option.label[locale] ?? ''}
                                      onChange={(event) =>
                                        update(index, {
                                          options: question.options.map((o, j) =>
                                            j === optionIndex
                                              ? { label: { ...o.label, [locale]: event.target.value } }
                                              : o,
                                          ),
                                        })
                                      }
                                      aria-invalid={optionError ? true : undefined}
                                      aria-describedby={optionError ? `${optionId}-error` : undefined}
                                    />
                                    {optionError ? (
                                      <p id={`${optionId}-error`} className={FORM_ERROR}>
                                        {optionError.text}
                                      </p>
                                    ) : null}
                                  </div>
                                );
                              })
                            : null}
                        </div>
                      );
                    })}
                  </div>
                </details>

                <div className="flex flex-wrap gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`${BTN_SMALL} ${BTN_RESET} min-w-11`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t('screeningMoveUp', { n: number })}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`${BTN_SMALL} ${BTN_RESET} min-w-11`}
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={t('screeningMoveDown', { n: number })}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`${BTN_SMALL} ${BTN_RESET} min-w-11`}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t('screeningRemove', { n: number })}
                  </Button>
                </div>
              </fieldset>
            );
          })}

          <Button
            type="button"
            variant="outline"
            className={`${BTN_SECONDARY} ${BTN_RESET}`}
            disabled={value.length >= SCREENING_LIMITS.questions}
            onClick={() => onChange([...value, emptyQuestion()])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('screeningAdd')}
          </Button>
          {listError ? <p className={FORM_ERROR}>{listError}</p> : null}
        </>
      )}
    </div>
  );
}
