'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { CANDIDATE_ADULT_AGE, candidateAgeBandsFor } from '@/lib/age-policy/constants';
import { cn } from '@/lib/utils';

/**
 * AgeDeclarationField — potwierdzenie przedziału wieku (#492, #576): „16–17 lat” albo
 * „18 lat lub więcej”.
 *
 * Osobny komponent, żeby formularze rejestracji (AuthForm) i ustawień kandydata miały jedną
 * treść i jedną semantykę pola. Minimalizacja: tylko przedział — bez daty i roku urodzenia.
 * Próg konta (`minAge`) przychodzi z serwera (`public.candidate_min_age()`), nie z kodu;
 * przedział poniżej progu nie jest pokazywany. Przy przedziale 16–17 pole wyjaśnia, że profil
 * nie będzie widoczny dla firm (LAUNCH-1).
 *
 * Kontrolowany: wybrany przedział (dolna granica: 16 albo 18) i komunikat błędu (już
 * przetłumaczony) trzyma formularz-rodzic. `ref` = pierwsza opcja (fokus po błędzie).
 */
export interface AgeDeclarationFieldProps {
  id: string;
  minAge: number;
  /** Wybrany przedział (16 albo 18); `null` = brak wyboru. */
  value: number | null;
  onChange: (value: number) => void;
  onBlur?: () => void;
  /** Przetłumaczony komunikat błędu przy polu; brak = pole poprawne. */
  error?: string | null;
  disabled?: boolean;
  /** Wariant etykiety: formularze auth (`auth`) albo kompaktowe formularze paszportu (`compact`). */
  variant?: 'auth' | 'compact';
}

export const AgeDeclarationField = React.forwardRef<HTMLInputElement, AgeDeclarationFieldProps>(
  function AgeDeclarationField(
    { id, minAge, value, onChange, onBlur, error, disabled, variant = 'auth' },
    ref,
  ) {
    const t = useTranslations('auth');
    const bands = candidateAgeBandsFor(minAge);
    const legendId = `${id}-legend`;
    const hintId = `${id}-hint`;
    const minorHintId = `${id}-minor-hint`;
    const errorId = `${id}-error`;
    const minorSelected = value !== null && value < CANDIDATE_ADULT_AGE;
    const describedBy = [hintId, minorSelected ? minorHintId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ');

    return (
      <fieldset className="space-y-1.5" aria-labelledby={legendId}>
        <legend
          id={legendId}
          className={cn(
            'font-medium text-foreground',
            variant === 'compact' ? 'text-[13px] leading-[1.5]' : 'text-sm leading-snug',
          )}
        >
          {t('ageBandLegend')}
        </legend>
        <div
          className="flex flex-col gap-1.5"
          role="radiogroup"
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-labelledby={legendId}
        >
          {bands.map((band, index) => {
            const optionId = `${id}-${band}`;
            return (
              <label
                key={band}
                htmlFor={optionId}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 font-normal',
                  variant === 'compact'
                    ? 'text-[13px] leading-[1.5] text-foreground'
                    : 'text-sm leading-snug text-muted-foreground',
                )}
              >
                <input
                  ref={index === 0 ? ref : undefined}
                  type="radio"
                  id={optionId}
                  name={id}
                  value={band}
                  checked={value === band}
                  onChange={() => onChange(band)}
                  onBlur={onBlur}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className={cn('h-4 w-4 shrink-0 accent-primary', error ? 'outline outline-1 outline-error' : undefined)}
                />
                {band < CANDIDATE_ADULT_AGE
                  ? t('ageBandMinor', { min: band, max: CANDIDATE_ADULT_AGE - 1 })
                  : t('ageBandAdult', { age: CANDIDATE_ADULT_AGE })}
              </label>
            );
          })}
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('ageConfirmHint')}
        </p>
        {minorSelected ? (
          <p id={minorHintId} className="text-xs text-muted-foreground">
            {t('ageBandMinorHint')}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-sm text-error">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  },
);
