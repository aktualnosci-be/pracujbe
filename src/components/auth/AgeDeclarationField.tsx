'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * AgeDeclarationField — deklaracja „mam co najmniej {minAge} lat” (#492).
 *
 * Osobny komponent, żeby formularze rejestracji (AuthForm), aplikacji gościa (GuestApplyForm)
 * i ustawień kandydata miały jedną treść i jedną semantykę pola, bez mieszania z polem zgód
 * rozwijanym w #493. Minimalizacja: tylko oświadczenie o progu — bez daty i roku urodzenia.
 * Próg (`minAge`) przychodzi z serwera (`public.candidate_min_age()`), nie z kodu.
 *
 * Kontrolowany: stan i komunikat błędu (już przetłumaczony) trzyma formularz-rodzic.
 */
export interface AgeDeclarationFieldProps {
  id: string;
  minAge: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onBlur?: () => void;
  /** Przetłumaczony komunikat błędu przy polu; brak = pole poprawne. */
  error?: string | null;
  disabled?: boolean;
  /** Wariant etykiety: formularze auth (`auth`) albo kompaktowe formularze paszportu (`compact`). */
  variant?: 'auth' | 'compact';
}

export const AgeDeclarationField = React.forwardRef<HTMLButtonElement, AgeDeclarationFieldProps>(
  function AgeDeclarationField(
    { id, minAge, checked, onCheckedChange, onBlur, error, disabled, variant = 'auth' },
    ref,
  ) {
    const t = useTranslations('auth');
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ');

    return (
      <div className="space-y-1.5">
        <div className={cn('flex items-start', variant === 'compact' ? 'gap-[9px]' : 'gap-2.5')}>
          <Checkbox
            ref={ref}
            id={id}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            onBlur={onBlur}
            disabled={disabled}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(variant === 'auth' ? 'mt-0.5' : undefined, error ? 'border-error' : undefined)}
          />
          <Label
            htmlFor={id}
            className={cn(
              'cursor-pointer font-normal',
              variant === 'compact'
                ? 'text-[13px] leading-[1.5] text-foreground'
                : 'text-sm leading-snug text-muted-foreground',
            )}
          >
            {t('ageConfirm', { age: minAge })}
          </Label>
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('ageConfirmHint')}
        </p>
        {error ? (
          <p id={errorId} className="text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
