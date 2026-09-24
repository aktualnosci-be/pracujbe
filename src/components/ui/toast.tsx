'use client';

import * as React from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * Toast — lekki komunikat zwrotny (np. „✓ Zapisano", błąd zapisu).
 *
 * Prezentacyjny komponent kliencki: renderuje kartę z ikoną (sukces/błąd), treścią
 * (przekazaną już przetłumaczoną) i przyciskiem zamknięcia (aria-label z i18n `nav.close`).
 * Pozycjonowanie i logikę pojawiania/znikania zapewnia ekran-rodzic. `role="status"`
 * + `aria-live` dla czytników ekranu.
 */

export interface ToastProps {
  message: string;
  tone?: 'success' | 'error';
  onClose?: () => void;
}

export function Toast({ message, tone = 'success', onClose }: ToastProps): React.JSX.Element {
  const t = useTranslations('nav');
  const isError = tone === 'error';
  const Icon = isError ? XCircle : CheckCircle2;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // `.notice` z prototypu „04 Ludzie i praca” (promień 16 px, linia, 13–15 px) jako komunikat.
        'flex items-start gap-3 rounded-[16px] border bg-card px-5 py-4 shadow-lg',
        isError ? 'border-error/30' : 'border-success/30',
      )}
    >
      <Icon
        className={cn('mt-0.5 h-5 w-5 shrink-0', isError ? 'text-error' : 'text-success')}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 break-words text-[13px] font-[650] leading-[1.5] text-foreground">{message}</p>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="-my-3 -mr-3 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
