import type * as React from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Mail, Phone } from 'lucide-react';

import type { JobApplyChannel } from '@/lib/jobs';
import { APPLY_LINK_REL, buildApplyLinks, type ApplyLink } from '@/lib/job-apply-links';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * „Aplikuj u pracodawcy” (#1130) — decyzja produktowa: portal ogłoszeniowy.
 *
 * W trybie ogłoszeniowym zastępuje `ApplyModal` na szczególe oferty. Przycisk główny prowadzi do
 * pierwszego kanału ogłoszeniodawcy (strona https w nowej karcie, `mailto:` albo `tel:`), wariant
 * `box` wymienia pod nim pozostałe kanały. Portal niczego nie zapisuje ani nie przekazuje —
 * zgłoszenie trafia bezpośrednio do ogłoszeniodawcy.
 *
 * Oferta bez kanału (stara, sprzed 0172): brak przycisku, wariant `box` pokazuje neutralny
 * komunikat, wariant `bar` nic nie renderuje.
 *
 * Komponent serwerowy (budżet JS szczegółu oferty, #395): kliknięcia liczy istniejąca wyspa
 * `JobFunnelBeacon` (`applyClicks`). Lejek ofert (#99): kliknięcie w kanał = `apply_started`,
 * wysyłane wyłącznie po zgodzie analitycznej (#575, bramka w `sendFunnelEvent`); oferta demo
 * nie jest liczona (bez znacznika `data-apply-job`).
 */
export interface EmployerApplyChannelProps {
  jobId: string;
  jobTitle: string;
  channel?: JobApplyChannel;
  demo?: boolean;
  variant: 'box' | 'bar';
  className?: string;
}

const ICONS = { url: ExternalLink, email: Mail, phone: Phone } as const;

export function EmployerApplyChannel({
  jobId,
  jobTitle,
  channel,
  demo = false,
  variant,
  className,
}: EmployerApplyChannelProps): React.JSX.Element | null {
  const t = useTranslations('job.employerApply');
  const links = buildApplyLinks(channel, t('mailSubject', { title: jobTitle }));
  // Znacznik dla nasłuchu lejka (`JobFunnelBeacon applyClicks`); oferta demo bez znacznika.
  const track = demo ? {} : ({ 'data-apply-job': jobId } as const);

  const [primary, ...others] = links;
  if (!primary) {
    return variant === 'box' ? (
      <p className={cn('text-sm text-muted-foreground', className)} data-testid="employer-apply-none">
        {t('none')}
      </p>
    ) : null;
  }

  const Icon = ICONS[primary.kind];
  return (
    <div className={cn(variant === 'bar' ? 'min-w-0 flex-1' : undefined, className)}>
      <a
        {...linkAttrs(primary)}
        {...track}
        data-testid="employer-apply-primary"
        data-apply-kind={primary.kind}
        className={cn(
          buttonVariants({ variant: 'default', size: 'passport' }),
          'h-auto w-full flex-col gap-0.5 whitespace-normal py-2.5 text-center',
        )}
      >
        <span className="flex items-center gap-2 font-medium">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('button')}
          {primary.external ? <span className="sr-only">{t('newTab')}</span> : null}
        </span>
        <span className="max-w-full break-all text-sm font-normal text-primary-foreground">
          {t(`hint.${primary.kind}`, { value: primary.display })}
        </span>
      </a>
      {variant === 'box' && others.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">{t('otherWays')}</p>
          <ul className="mt-1 space-y-1">
            {others.map((link) => {
              const OtherIcon = ICONS[link.kind];
              return (
                <li key={link.kind}>
                  <a
                    {...linkAttrs(link)}
                    {...track}
                    data-apply-kind={link.kind}
                    className="inline-flex min-h-6 items-center gap-2 break-all text-sm font-medium text-foreground underline underline-offset-2 hover:text-accent"
                  >
                    <OtherIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t(`hint.${link.kind}`, { value: link.display })}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function linkAttrs(link: ApplyLink): React.AnchorHTMLAttributes<HTMLAnchorElement> {
  return link.external ? { href: link.href, target: '_blank', rel: APPLY_LINK_REL } : { href: link.href };
}
