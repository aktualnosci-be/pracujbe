'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { respondToOffer } from '@/lib/actions/offers';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';

/**
 * ProposalActions — odpowiedź kandydata na propozycję pracy (przyjmij / odrzuć).
 *
 * Cienki fragment kliencki nad Server Action `respondToOffer(offerId, accept)`; zapis idzie
 * pod sesją (RLS + trigger dopuszczają dla odbiorcy tylko 'accepted'/'declined'). Przyciski
 * blokowane w trakcie (Invariant #11), po sukcesie odświeżamy trasę (StatusPill), a błąd
 * mapujemy na komunikat i18n (bez technikaliów — Invariant #8).
 *
 * Reużywalny w sekcji/route propozycji kandydata; renderuje przyciski tylko dla statusów,
 * na które można jeszcze odpowiedzieć (sent/viewed).
 */

/** Statusy propozycji, na które kandydat może jeszcze odpowiedzieć. */
const RESPONDABLE = new Set(['sent', 'viewed']);

export function ProposalActions({
  offerId,
  status,
  className,
}: {
  offerId: string;
  status: string;
  className?: string;
}): React.JSX.Element | null {
  const td = useTranslations('dashboard');
  const te = useTranslations('errors');
  const router = useRouter();

  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState(false);
  const requestPendingRef = React.useRef(false);

  if (!RESPONDABLE.has(status)) return null;

  const respond = (accept: boolean) => {
    if (pending || requestPendingRef.current) return;
    requestPendingRef.current = true;
    setError(false);
    startTransition(async () => {
      try {
        const res = await respondToOffer(offerId, accept);
        if (res.ok) {
          router.refresh();
          return;
        }
        setError(true);
      } catch {
        setError(true);
      } finally {
        requestPendingRef.current = false;
      }
    });
  };

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => respond(true)}
          disabled={pending}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {td('acceptProposal')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => respond(false)}
          disabled={pending}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {td('declineProposal')}
        </Button>
      </div>

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={te('generic')} tone="error" onClose={() => setError(false)} />
        </div>
      ) : null}
    </div>
  );
}
