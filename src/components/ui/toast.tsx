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
        'flex items-start gap-3 rounded-lg border bg-background p-4 shadow-sm',
        isError ? 'border-error/30' : 'border-success/30',
      )}
    >
      <Icon
        className={cn('mt-0.5 h-5 w-5 shrink-0', isError ? 'text-error' : 'text-success')}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm text-foreground">{message}</p>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-soft hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
