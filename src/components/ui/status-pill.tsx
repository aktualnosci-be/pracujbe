import * as React from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * StatusPill — pigułka statusu (aplikacja / oferta / propozycja).
 *
 * Przyjmuje surowy status (np. `submitted`, `offer_sent`, `active`), normalizuje go do
 * klucza camelCase i pobiera etykietę z i18n `status.<camel>` (bez literałów w JSX).
 * Kolor wg mapy statusów z DESIGN_SCREENS.md — wyłącznie klasy tokenów (bez hexów):
 *   niebieski (accent) = submitted/offerSent · amber (warning) = viewed ·
 *   zielony (success) = shortlisted/interview/offerAccepted/hired ·
 *   czerwony (error) = rejected/offerDeclined · neutralny = draft/withdrawn/closed.
 * Statusy „active"/„paused" (oferta) mają kropkę wskaźnika zamiast pełnego tła koloru.
 *
 * Komponent serwerowy (next-intl `useTranslations` działa w RSC i po stronie klienta),
 * więc może być użyty w dowolnym ekranie.
 */

type Tone = 'blue' | 'amber' | 'green' | 'red' | 'neutral' | 'activeDot' | 'pausedDot';

/** Mapa: znormalizowany klucz statusu (camelCase) → ton kolorystyczny. */
const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'blue',
  viewed: 'amber',
  shortlisted: 'green',
  interview: 'green',
  offerSent: 'blue',
  offerAccepted: 'green',
  offerDeclined: 'red',
  rejected: 'red',
  withdrawn: 'neutral',
  hired: 'green',
  active: 'activeDot',
  paused: 'pausedDot',
  closed: 'neutral',
  expired: 'neutral',
};

const TONE_CLASS: Record<Tone, string> = {
  blue: 'bg-accent/10 text-accent-dark',
  amber: 'bg-warning/10 text-warning-text',
  green: 'bg-success/10 text-success-text',
  red: 'bg-error/10 text-error-text',
  neutral: 'bg-muted text-muted-foreground',
  activeDot: 'bg-success/10 text-success-text',
  pausedDot: 'bg-warning/10 text-warning-text',
};

/** snake_case / kebab-case → camelCase (dla kluczy i18n). */
export function toCamel(value: string): string {
  return value.replace(/[_-]([a-z])/g, (_, char: string) => char.toUpperCase());
}

export interface StatusPillProps {
  status: string;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps): React.JSX.Element {
  const t = useTranslations('status');
  const key = toCamel(status.trim());
  const known = key in STATUS_TONE;
  const tone: Tone = known ? (STATUS_TONE[key] ?? 'neutral') : 'neutral';
  // Dla znanych statusów etykieta z i18n; nieznany (spoza enumu) → surowa wartość jako fallback.
  const label = known ? t(key) : status;
  const showDot = tone === 'activeDot' || tone === 'pausedDot';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {showDot ? (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            tone === 'activeDot' ? 'bg-success' : 'bg-warning',
          )}
          aria-hidden="true"
        />
      ) : null}
      {label}
    </span>
  );
}
