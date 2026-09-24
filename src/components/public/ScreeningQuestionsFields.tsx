'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  localizedText,
  SCREENING_LIMITS,
  type ScreeningAnswerValue,
  type ScreeningQuestion,
} from '@/lib/screening/questions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Pytania screeningowe oferty w formularzu aplikowania (#101). Kandydat widzi przed wysłaniem,
 * co się stanie z odpowiedziami: trafią do firmy razem ze zgłoszeniem i nie zmieniają
 * dopasowania ani statusu. Wymagalność sprawdza też baza (`apply_to_job`).
 *
 * Invariant #11: błąd przy pytaniu (`aria-invalid` + `aria-describedby`), fokus na pierwszym
 * błędzie robi formularz (`screeningFieldId`).
 */

/** Id pierwszego pola pytania (fokus przy błędzie). */
export function screeningFieldId(questionId: string): string {
  return `apply-q-${questionId}`;
}

export interface ScreeningQuestionsFieldsProps {
  questions: ScreeningQuestion[];
  contentLocale?: string;
  companyName: string;
  values: Record<string, ScreeningAnswerValue>;
  errors: Record<string, true>;
  onChange: (questionId: string, value: ScreeningAnswerValue | undefined) => void;
}

export function ScreeningQuestionsFields({
  questions,
  contentLocale,
  companyName,
  values,
  errors,
  onChange,
}: ScreeningQuestionsFieldsProps): React.JSX.Element | null {
  const t = useTranslations('apply');
  const locale = useLocale();
  if (questions.length === 0) return null;

  return (
    <section aria-labelledby="apply-screening-title" className="space-y-4 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <h3 id="apply-screening-title" className="text-sm font-semibold text-foreground">
          {t('screeningTitle')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('screeningNote', { company: companyName })}</p>
      </div>

      {questions.map((question) => {
        const fieldId = screeningFieldId(question.id);
        const errorId = `${fieldId}-error`;
        const invalid = errors[question.id] === true;
        const prompt = localizedText(question.prompt, locale, contentLocale);
        const marker = question.required ? (
          <span className="text-error" aria-hidden="true">
            {' '}*
          </span>
        ) : (
          <span className="font-normal text-muted-foreground"> {t('screeningOptional')}</span>
        );
        const error = invalid ? (
          <p id={errorId} className="text-sm text-error">
            {t('screeningRequired')}
          </p>
        ) : null;
        const value = values[question.id];

        if (question.type === 'yes_no' || question.type === 'single_choice') {
          const choices =
            question.type === 'yes_no'
              ? [
                  { key: 'yes', label: t('screeningYes'), value: true as ScreeningAnswerValue },
                  { key: 'no', label: t('screeningNo'), value: false as ScreeningAnswerValue },
                ]
              : question.options.map((option) => ({
                  key: option.id,
                  label: localizedText(option.label, locale, contentLocale),
                  value: option.id as ScreeningAnswerValue,
                }));
          return (
            <div key={question.id} className="space-y-2">
              <p id={`${fieldId}-label`} className="text-sm font-medium text-foreground">
                {prompt}
                {marker}
              </p>
              <div
                role="radiogroup"
                aria-labelledby={`${fieldId}-label`}
                aria-required={question.required ? true : undefined}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={invalid ? errorId : undefined}
                className={cn('flex flex-wrap gap-x-5 gap-y-2', question.type === 'single_choice' && 'flex-col')}
              >
                {choices.map((choice, index) => {
                  const id = index === 0 ? fieldId : `${fieldId}-${choice.key}`;
                  return (
                    <label key={choice.key} htmlFor={id} className="inline-flex min-h-6 cursor-pointer items-center gap-2 text-sm text-foreground">
                      <input
                        id={id}
                        type="radio"
                        name={fieldId}
                        className="h-4 w-4 accent-primary"
                        checked={value === choice.value}
                        onChange={() => onChange(question.id, choice.value)}
                      />
                      {choice.label}
                    </label>
                  );
                })}
              </div>
              {error}
            </div>
          );
        }

        return (
          <div key={question.id} className="space-y-1.5">
            <Label htmlFor={fieldId}>
              {prompt}
              {marker}
            </Label>
            <Input
              id={fieldId}
              type={question.type === 'date' ? 'date' : 'text'}
              value={typeof value === 'string' ? value : ''}
              maxLength={question.type === 'short_text' ? SCREENING_LIMITS.answer : undefined}
              onChange={(event) => onChange(question.id, event.target.value)}
              aria-required={question.required ? 'true' : undefined}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
              className={invalid ? 'border-error' : undefined}
            />
            {error}
          </div>
        );
      })}
    </section>
  );
}
