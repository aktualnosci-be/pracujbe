'use client';

import * as React from 'react';
import { X, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { isNewProposalStatus } from '@/lib/candidate-offers';
import { BTN_PRIMARY, NOTICE, NOTICE_TITLE } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * NewProposalBanner — baner „Nowa propozycja pracy dopasowana do Twojego profilu".
 * Wygląd: `.notice` z prototypu „04 Ludzie i praca” (jasne tło marki, czerwona ramka,
 * `.notice strong`, przycisk `.btn`); przycisk zamknięcia w rogu (odstępstwo — prototyp
 * go nie ma, aplikacja pozwala ukryć baner).
 *
 * Komponent kliencki wyłącznie dla zamykania (useState). Treść z i18n (`dashboard`).
 * Renderuje się tylko dla propozycji, na którą kandydat może jeszcze odpowiedzieć.
 */
export function NewProposalBanner({
  status,
  href,
}: {
  status: string;
  href: string;
}): React.JSX.Element | null {
  const t = useTranslations('dashboard');
  const tn = useTranslations('nav');
  const [open, setOpen] = React.useState(true);

  if (!open || !isNewProposalStatus(status)) return null;

  return (
    <div className={cn(NOTICE, 'relative pr-14 max-[600px]:pr-14')}>
      <div className="min-w-0">
        <p className={NOTICE_TITLE}>{t('newOfferBanner')}</p>
      </div>
      <Link
        href={href}
        className={cn(BTN_PRIMARY, 'min-h-11 shrink-0 px-[17px] py-[11px] text-xs')}
      >
        {t('viewProposal')}
        <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={tn('close')}
        className="absolute right-1.5 top-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
