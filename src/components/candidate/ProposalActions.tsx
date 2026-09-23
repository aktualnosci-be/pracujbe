'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { respondToOffer } from '@/lib/actions/offers';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const MAX_TIMEOUT_MS = 2_147_483_647;

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
 *
 * Odrzucenie jest stanem końcowym, więc wymaga potwierdzenia w `ConfirmDialog` (#328);
 * anulowanie nie woła akcji i oddaje fokus przyciskowi „Odrzuć". Po udanej odpowiedzi zostaje
 * komunikat `role="status"`, który dostaje fokus (przyciski znikają po odświeżeniu trasy).
 */

export function ProposalActions({
  offerId,
  expiresAt,
  initialCanRespond,
  jobTitle,
  className,
}: {
  offerId: string;
  /** Tytuł oferty do treści potwierdzenia (opcjonalny — bez niego tekst ogólny). */
  jobTitle?: string;
  expiresAt: string | null;
  initialCanRespond: boolean;
  className?: string;
}): React.JSX.Element | null {
  const td = useTranslations('dashboard');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();

  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState(false);
  const [canRespond, setCanRespond] = React.useState(initialCanRespond);
  const requestPendingRef = React.useRef(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [responded, setResponded] = React.useState<'accepted' | 'declined' | null>(null);
  const declineRef = React.useRef<HTMLButtonElement>(null);
  const statusRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Dialog oddaje fokus sam (getReturnFocus); przy przyjęciu bez dialogu robimy to tutaj.
    if (responded === 'accepted') statusRef.current?.focus();
  }, [responded]);

  React.useEffect(() => {
    if (!initialCanRespond) {
      setCanRespond(false);
      return;
    }
    if (expiresAt === null) return;

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      setCanRespond(false);
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scheduleExpiry = () => {
      const remaining = expiresAtMs - Date.now();
      if (remaining <= 0) {
        setCanRespond(false);
        return;
      }
      timeout = setTimeout(scheduleExpiry, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    scheduleExpiry();

    return () => {
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [expiresAt, initialCanRespond]);

  const successMessage =
    responded === 'accepted'
      ? td('acceptProposalSuccess')
      : responded === 'declined'
        ? td('declineProposalSuccess')
        : null;
  const successNode = successMessage ? (
    <div
      ref={statusRef}
      role="status"
      tabIndex={-1}
      className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {successMessage}
    </div>
  ) : null;

  const showActions = initialCanRespond && canRespond;
  // Po odpowiedzi odświeżona trasa odbiera akcje; komunikat zostaje w tym samym miejscu drzewa,
  // więc nie jest montowany od nowa i nie gubi fokusu.
  if (!showActions && !successNode) return null;

  const respond = (accept: boolean) => {
    if (pending || requestPendingRef.current) return;
    requestPendingRef.current = true;
    setError(false);
    startTransition(async () => {
      try {
        const res = await respondToOffer(offerId, accept);
        setConfirmOpen(false);
        if (res.ok) {
          setResponded(accept ? 'accepted' : 'declined');
          router.refresh();
          return;
        }
        setError(true);
      } catch {
        setConfirmOpen(false);
        setError(true);
      } finally {
        requestPendingRef.current = false;
      }
    });
  };

  return (
    <div className={className}>
      {showActions ? <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          className="h-auto min-h-12 w-full min-w-0 whitespace-normal text-center sm:w-auto"
          onClick={() => respond(true)}
          disabled={pending}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {td('acceptProposal')}
        </Button>
        <Button
          ref={declineRef}
          type="button"
          variant="outline"
          className="h-auto min-h-12 w-full min-w-0 whitespace-normal text-center sm:w-auto"
          onClick={() => setConfirmOpen(true)}
          disabled={pending}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {td('declineProposal')}
        </Button>
      </div> : null}

      {successNode ? <div className={showActions ? 'mt-3' : undefined}>{successNode}</div> : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={td('declineConfirmTitle')}
        description={
          jobTitle
            ? td('declineConfirmDescriptionNamed', { title: jobTitle })
            : td('declineConfirmDescription')
        }
        confirmLabel={td('declineConfirm')}
        cancelLabel={tc('cancel')}
        onConfirm={() => respond(false)}
        pending={pending}
        getReturnFocus={() => statusRef.current ?? declineRef.current}
      />

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={te('generic')} tone="error" onClose={() => setError(false)} />
        </div>
      ) : null}
    </div>
  );
}
