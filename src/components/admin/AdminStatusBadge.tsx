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

type Tone = 'blue' | 'amber' | 'green' | 'red' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  blue: 'bg-accent/10 text-accent-dark',
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
  reviewing: 'blue',
  resolved: 'green',
  dismissed: 'neutral',
};

const REPORT_KEY: Record<string, string> = {
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
  const keyMap = kind === 'company' ? COMPANY_STATUS_KEY : REPORT_KEY;

  const tone: Tone = toneMap[status] ?? 'neutral';
  const messageKey = keyMap[status];
  const label = messageKey ? t(messageKey) : status;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
