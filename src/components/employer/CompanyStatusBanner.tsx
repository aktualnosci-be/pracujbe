import * as React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { INLINE_LINK, NOTICE, NOTICE_TEXT, NOTICE_TITLE } from '@/components/dashboard/panel-styles';

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

/** Ton na bazie `.notice` prototypu (czerwona ramka na jasnym tle); sukces/błąd — kolory semantyczne. */
const TONE_CLASS: Record<Tone, string> = {
  info: 'text-foreground',
  success: 'border-success/30 bg-success/10 text-foreground',
  error: 'border-error/30 bg-error/10 text-foreground',
};

const ICON_CLASS: Record<Tone, string> = {
  info: 'text-primary',
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
  /**
   * Uzasadnienie admina dla odrzuconej/zawieszonej firmy (#310) — pokazywane w wariancie
   * `company` tylko przy statusie rejected/suspended.
   */
  reason?: string | null;
  className?: string;
}

export function CompanyStatusBanner({
  status,
  variant = 'company',
  action,
  reason,
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
      className={cn(
        NOTICE,
        'my-0 items-start justify-start gap-3 max-[600px]:flex-row max-[600px]:gap-3',
        TONE_CLASS[config.tone],
        className,
      )}
    >
      <ToneIcon tone={config.tone} />
      <div className="min-w-0 space-y-2">
        <div>
          <p className={NOTICE_TITLE}>{t(config.titleKey)}</p>
          <p className={cn(NOTICE_TEXT, 'mb-0')}>
            {variant === 'wizard' ? t('wizardNotice') : t(config.descKey)}
          </p>
        </div>

        {variant === 'dashboard' && awaiting ? (
          <div>
            <p className="text-[13px] font-semibold text-foreground">{t('stepsTitle')}</p>
            <ol className={cn(NOTICE_TEXT, 'mb-0 list-decimal space-y-0.5 pl-5')}>
              <li>{t('stepVat')}</li>
              <li>{t('stepWait')}</li>
              <li>{t('stepDraft')}</li>
            </ol>
          </div>
        ) : null}

        {variant !== 'company' ? (
          <Link
            href="/employer/firma"
            className={cn(INLINE_LINK, 'inline-flex min-h-11 items-center gap-1 text-[13px] underline')}
          >
            {t('bannerLink')}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}

        {variant === 'company' && reason && (status === 'rejected' || status === 'suspended') ? (
          <div>
            <p className="text-[13px] font-semibold text-foreground">{t('bannerReasonLabel')}</p>
            <p className="whitespace-pre-line break-words text-[13px] text-foreground">{reason}</p>
          </div>
        ) : null}

        {variant === 'company' && action ? action : null}
      </div>
    </div>
  );
}
