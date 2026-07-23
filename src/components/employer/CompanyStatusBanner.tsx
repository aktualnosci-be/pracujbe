import * as React from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * CompanyStatusBanner — baner statusu weryfikacji firmy (panel pracodawcy, Etap 4).
 *
 * Mapuje `company_status` na ton i komunikat (klucze i18n, namespace `company`):
 *   - unverified / pending → info „oczekuje na weryfikację" (zegar),
 *   - verified            → success „zweryfikowana" (ptaszek),
 *   - rejected / suspended → error (alert).
 *
 * Komponent serwerowy (bez interakcji) — `useTranslations` działa w RSC. Kolory wyłącznie
 * klasami tokenów (bez hexów), zgodnie z systemem wizualnym.
 */

type Tone = 'info' | 'success' | 'error';

interface BannerConfig {
  tone: Tone;
  titleKey: string;
  descKey: string;
}

/** company_status → konfiguracja baneru. Nieznany status traktujemy jak „oczekuje". */
const STATUS_CONFIG: Record<string, BannerConfig> = {
  unverified: { tone: 'info', titleKey: 'bannerPendingTitle', descKey: 'bannerPendingDesc' },
  pending: { tone: 'info', titleKey: 'bannerPendingTitle', descKey: 'bannerPendingDesc' },
  verified: { tone: 'success', titleKey: 'bannerVerifiedTitle', descKey: 'bannerVerifiedDesc' },
  rejected: { tone: 'error', titleKey: 'bannerRejectedTitle', descKey: 'bannerRejectedDesc' },
  suspended: { tone: 'error', titleKey: 'bannerSuspendedTitle', descKey: 'bannerSuspendedDesc' },
};

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-accent/30 bg-accent/10 text-foreground',
  success: 'border-success/30 bg-success/10 text-foreground',
  error: 'border-error/30 bg-error/10 text-foreground',
};

const ICON_CLASS: Record<Tone, string> = {
  info: 'text-accent',
  success: 'text-success',
  error: 'text-error',
};

function ToneIcon({ tone }: { tone: Tone }): React.JSX.Element {
  const className = cn('mt-0.5 h-5 w-5 shrink-0', ICON_CLASS[tone]);
  if (tone === 'success') return <CheckCircle2 className={className} aria-hidden="true" />;
  if (tone === 'error') return <AlertCircle className={className} aria-hidden="true" />;
  return <Clock className={className} aria-hidden="true" />;
}

export interface CompanyStatusBannerProps {
  /** Surowy `company_status`: unverified/pending/verified/rejected/suspended. */
  status: string;
  className?: string;
}

export function CompanyStatusBanner({
  status,
  className,
}: CompanyStatusBannerProps): React.JSX.Element {
  const t = useTranslations('company');
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['pending']!;

  return (
    <div
      role="status"
      className={cn('flex items-start gap-3 rounded-md border p-4 text-sm', TONE_CLASS[config.tone], className)}
    >
      <ToneIcon tone={config.tone} />
      <div className="space-y-0.5">
        <p className="font-semibold">{t(config.titleKey)}</p>
        <p className="text-muted-foreground">{t(config.descKey)}</p>
      </div>
    </div>
  );
}
