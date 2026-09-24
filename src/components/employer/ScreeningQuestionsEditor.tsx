'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { localeNames, routing, type Locale } from '@/i18n/routing';
import {
  localizedText,
  SCREENING_LIMITS,
  SCREENING_QUESTION_TYPES,
  type ScreeningQuestionDraft,
  type ScreeningQuestionType,
} from '@/lib/screening/questions';
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
}

export function ScreeningQuestionsEditor({
  value,
  onChange,
  contentLocale,
  readOnly,
  errors,
}: ScreeningQuestionsEditorProps): React.JSX.Element {
  const t = useTranslations('jobWizard');
  const tRoot = useTranslations();
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
    <div id="job-screeningQuestions" className="space-y-3 border-t border-border pt-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{t('screeningTitle')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('screeningHint', { max: SCREENING_LIMITS.questions })}
        </p>
        {readOnly ? (
          <p className="text-sm text-muted-foreground" data-testid="screening-read-only">
            {t('screeningReadOnly')}
          </p>
        ) : null}
      </div>

      {readOnly ? (
        value.length > 0 ? (
          <ol className="list-inside list-decimal space-y-1 text-sm text-foreground">
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
          <p className="text-sm text-muted-foreground">{t('screeningEmpty')}</p>
        )
      ) : (
        <>
          {value.map((question, index) => {
            const number = index + 1;
            const promptError = errorFor(`${index}.prompt`, `${index}.prompt.${contentLocale}`);
            const typeError = errorFor(String(index));
            const countError = errorFor(`${index}.options`);
            const promptId = fieldPromptId(index, contentLocale, contentLocale);
            return (
              <fieldset
                key={index}
                className="space-y-3 rounded-lg border border-border p-3 sm:p-4"
                data-testid={`screening-question-${number}`}
              >
                <legend className="px-1 text-sm font-semibold text-foreground">
                  {t('screeningQuestion', { n: number })}
                </legend>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="w-full space-y-1.5 sm:w-60">
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
                      <p id={`job-sq-${index}-type-error`} className="text-sm text-error">
                        {typeError.text}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex min-h-10 items-center gap-2.5">
                    <Checkbox
                      id={`job-sq-${index}-required`}
                      checked={question.required}
                      onCheckedChange={(checked) => update(index, { required: checked === true })}
                    />
                    <Label htmlFor={`job-sq-${index}-required`} className="text-sm font-normal">
                      {t('screeningRequired')}
                    </Label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={promptId}>
                    {t('screeningPrompt', { language: languageName(contentLocale) })}
                  </Label>
                  <Input
                    id={promptId}
                    value={question.prompt[contentLocale] ?? ''}
                    placeholder={t('screeningPromptPlaceholder')}
                    onChange={(event) =>
                      update(index, { prompt: { ...question.prompt, [contentLocale]: event.target.value } })
                    }
                    aria-invalid={promptError ? true : undefined}
                    aria-describedby={promptError ? `${promptId}-error` : undefined}
                  />
                  {promptError ? (
                    <p id={`${promptId}-error`} className="text-sm text-error">
                      {promptError.text}
                    </p>
                  ) : null}
                </div>

                {question.type === 'single_choice' ? (
                  <div className="space-y-2">
                    {question.options.map((option, optionIndex) => {
                      const optionId = fieldOptionId(index, optionIndex, contentLocale, contentLocale);
                      const optionError = errorFor(
                        `${index}.options.${optionIndex}`,
                        `${index}.options.${optionIndex}.${contentLocale}`,
                      );
                      return (
                        <div key={optionIndex} className="space-y-1">
                          <Label htmlFor={optionId}>
                            {t('screeningOption', { n: optionIndex + 1, language: languageName(contentLocale) })}
                          </Label>
                          <div className="flex gap-2">
                            <Input
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
                            <p id={`${optionId}-error`} className="text-sm text-error">
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
                      disabled={question.options.length >= SCREENING_LIMITS.optionsMax}
                      aria-describedby={countError ? `job-sq-${index}-options-error` : undefined}
                      onClick={() => update(index, { options: [...question.options, { label: {} }] })}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('screeningAddOption')}
                    </Button>
                    {countError ? (
                      <p id={`job-sq-${index}-options-error`} className="text-sm text-error">
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
                  className="rounded-md bg-soft p-3"
                >
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    {t('screeningTranslations')}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {others.map((locale) => {
                      const id = fieldPromptId(index, locale, contentLocale);
                      const error = errorFor(`${index}.prompt.${locale}`);
                      return (
                        <div key={locale} className="space-y-2">
                          <div className="space-y-1">
                            <Label htmlFor={id}>{t('screeningPrompt', { language: languageName(locale) })}</Label>
                            <Input
                              id={id}
                              value={question.prompt[locale] ?? ''}
                              onChange={(event) =>
                                update(index, { prompt: { ...question.prompt, [locale]: event.target.value } })
                              }
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `${id}-error` : undefined}
                            />
                            {error ? (
                              <p id={`${id}-error`} className="text-sm text-error">
                                {error.text}
                              </p>
                            ) : null}
                          </div>
                          {question.type === 'single_choice'
                            ? question.options.map((option, optionIndex) => {
                                const optionId = fieldOptionId(index, optionIndex, locale, contentLocale);
                                const optionError = errorFor(`${index}.options.${optionIndex}.${locale}`);
                                return (
                                  <div key={optionIndex} className="space-y-1 pl-3">
                                    <Label htmlFor={optionId}>
                                      {t('screeningOption', { n: optionIndex + 1, language: languageName(locale) })}
                                    </Label>
                                    <Input
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
                                      <p id={`${optionId}-error`} className="text-sm text-error">
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

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
            disabled={value.length >= SCREENING_LIMITS.questions}
            onClick={() => onChange([...value, emptyQuestion()])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('screeningAdd')}
          </Button>
          {listError ? <p className="text-sm text-error">{listError}</p> : null}
        </>
      )}
    </div>
  );
}
