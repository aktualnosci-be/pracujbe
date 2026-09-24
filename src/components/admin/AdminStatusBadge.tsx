import * as React from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * AdminStatusBadge — pigułka statusu firmy lub zgłoszenia (panel admina).
 *
 * StatusPill z `@/components/ui` nie zna statusów `company_status`/`report_status`, dlatego
 * panel admina ma własny, dedykowany badge. Etykiety z i18n (namespace `admin`), kolory
 * wyłącznie klasami tokenów (bez hexów). Komponent serwerowy (useTranslations działa w RSC).
 */

type Tone = 'info' | 'amber' | 'green' | 'red' | 'neutral';

/**
 * Czerwień (`accent` po zmianie marki i `error`) tylko dla stanów negatywnych — „W trakcie”
 * to stan informacyjny (#422): obramowany, neutralny, kontrast AA na tokenach `foreground`.
 */
const TONE_CLASS: Record<Tone, string> = {
  info: 'bg-card text-foreground ring-1 ring-inset ring-border',
  amber: 'bg-warning/10 text-warning-text',
  green: 'bg-success/10 text-success-text',
  red: 'bg-error/10 text-error-text',
  neutral: 'bg-muted text-muted-foreground',
};

const COMPANY_TONE: Record<string, Tone> = {
  unverified: 'neutral',
  pending: 'amber',
  verified: 'green',
  rejected: 'red',
  suspended: 'red',
};

export const COMPANY_STATUS_KEY: Record<string, string> = {
  unverified: 'statusUnverified',
  pending: 'statusPending',
  verified: 'statusVerified',
  rejected: 'statusRejected',
  suspended: 'statusSuspended',
};

const REPORT_TONE: Record<string, Tone> = {
  open: 'amber',
  reviewing: 'info',
  resolved: 'green',
  dismissed: 'neutral',
};

export const REPORT_STATUS_KEY: Record<string, string> = {
  open: 'statusOpen',
  reviewing: 'statusReviewing',
  resolved: 'statusResolved',
  dismissed: 'statusDismissed',
};

export interface AdminStatusBadgeProps {
  /** Rodzaj słownika statusów. */
  kind: 'company' | 'report';
  /** Surowy status z DB. */
  status: string;
  className?: string;
}

export function AdminStatusBadge({
  kind,
  status,
  className,
}: AdminStatusBadgeProps): React.JSX.Element {
  const t = useTranslations('admin');
  const toneMap = kind === 'company' ? COMPANY_TONE : REPORT_TONE;
  const keyMap = kind === 'company' ? COMPANY_STATUS_KEY : REPORT_STATUS_KEY;

  const tone: Tone = toneMap[status] ?? 'neutral';
  const messageKey = keyMap[status];
  const label = messageKey ? t(messageKey) : status;

  return (
    <span
      className={cn(
        // Kształt `.tag` z prototypu (#5); kolor semantyczny statusu zostaje (tokeny `-text`, AA).
        'inline-block max-w-full break-words rounded-[6px] px-2 py-[5px] text-[11px] font-medium max-[600px]:text-[10px]',
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
