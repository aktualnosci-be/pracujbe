'use client';

import * as React from 'react';
import { CheckCircle2, X, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { isNewProposalStatus } from '@/lib/candidate-offers';

/**
 * NewProposalBanner — baner „Nowa propozycja pracy dopasowana do Twojego profilu"
 * z makiety 04. Zielony znacznik, treść, odnośnik „Zobacz ofertę" oraz przycisk zamknięcia.
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
    <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-foreground">
        {t('newOfferBanner')}{' '}
        <Link
          href={href}
          className="inline-flex items-center gap-1 font-medium text-accent-dark hover:underline"
        >
          {t('viewOffer')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={tn('close')}
        className="-m-3 flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
