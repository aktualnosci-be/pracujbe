import * as React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * CompanyStatusBanner — baner statusu weryfikacji firmy (panel pracodawcy, Etap 4).
 *
 * Mapuje `company_status` na ton i komunikat (klucze i18n, namespace `company`):
 *   - unverified / pending → info „czeka na weryfikację" (zegar),
 *   - verified            → success „zweryfikowana" (ptaszek),
 *   - rejected / suspended → error (alert).
 *
 * Warianty (#399):
 *   - `company` (domyślny) — strona `/employer/firma`, pokazuje także stan `verified`;
 *     `action` (np. ponowne zgłoszenie odrzuconej firmy) renderuje się pod opisem.
 *   - `dashboard` — pulpit: dla niezweryfikowanej firmy checklista „Pierwsze kroki"
 *     i link do danych firmy; `verified` → brak baneru (bez szumu).
 *   - `wizard` — nad kreatorem oferty: szkic teraz, publikacja po weryfikacji; `verified` → brak.
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

/** company_status → konfiguracja baneru. Nieznany status traktujemy jak „czeka". */
const STATUS_CONFIG: Record<string, BannerConfig> = {
  unverified: { tone: 'info', titleKey: 'bannerUnverifiedTitle', descKey: 'bannerUnverifiedDesc' },
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
  /** Miejsce wyświetlenia — patrz opis modułu. Domyślnie `company`. */
  variant?: 'company' | 'dashboard' | 'wizard';
  /** Dodatkowa akcja pod opisem (wariant `company`). */
  action?: React.ReactNode;
  className?: string;
}

export function CompanyStatusBanner({
  status,
  variant = 'company',
  action,
  className,
}: CompanyStatusBannerProps): React.JSX.Element | null {
  const t = useTranslations('company');
  if (variant !== 'company' && status === 'verified') return null;
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['pending']!;
  const awaiting = config.tone === 'info';

  return (
    <div
      role="status"
      data-company-status={status}
      className={cn('flex items-start gap-3 rounded-md border p-4 text-sm', TONE_CLASS[config.tone], className)}
    >
      <ToneIcon tone={config.tone} />
      <div className="min-w-0 space-y-2">
        <div className="space-y-0.5">
          <p className="font-semibold">{t(config.titleKey)}</p>
          <p className="text-muted-foreground">
            {variant === 'wizard' ? t('wizardNotice') : t(config.descKey)}
          </p>
        </div>

        {variant === 'dashboard' && awaiting ? (
          <div>
            <p className="font-medium">{t('stepsTitle')}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
              <li>{t('stepVat')}</li>
              <li>{t('stepWait')}</li>
              <li>{t('stepDraft')}</li>
            </ol>
          </div>
        ) : null}

        {variant !== 'company' ? (
          <Link
            href="/employer/firma"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('bannerLink')}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}

        {variant === 'company' && action ? action : null}
      </div>
    </div>
  );
}
