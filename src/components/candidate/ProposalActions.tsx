'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { respondToOffer } from '@/lib/actions/offers';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BTN_PRIMARY, BTN_RESET, BTN_SECONDARY } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

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
 *
 * Upływ terminu w trakcie wizyty (#830): od chwili `expiresAt` nie można ROZPOCZĄĆ nowej
 * odpowiedzi (baza i tak odrzuca `expires_at <= now()`), ale bieżąca operacja i jej wynik
 * zostają widoczne. Trwające żądanie trzyma zablokowane przyciski i dialog do wyniku; otwarte
 * potwierdzenie bez żądania zamyka się, a fokus trafia na komunikat o upływie terminu. Błąd po
 * terminie pokazuje komunikat i odświeża trasę, żeby karta pokazała rzeczywisty stan (odpowiedź
 * mogła zostać zapisana tuż przed terminem — wtedy `status` z serwera zamienia błąd w sukces).
 * `onExpire` pozwala liście zmienić etykietę karty na „Wygasła” bez czekania na serwer.
 */

export function ProposalActions({
  offerId,
  expiresAt,
  initialCanRespond,
  jobTitle,
  status,
  onExpire,
  className,
}: {
  offerId: string;
  /** Tytuł oferty do treści potwierdzenia (opcjonalny — bez niego tekst ogólny). */
  jobTitle?: string;
  expiresAt: string | null;
  initialCanRespond: boolean;
  /** Zapisany status propozycji z serwera (po odświeżeniu trasy rozstrzyga wynik po błędzie). */
  status?: string;
  /** Wywoływane raz, gdy termin odpowiedzi minie podczas wizyty. */
  onExpire?: () => void;
  className?: string;
}): React.JSX.Element | null {
  const td = useTranslations('dashboard');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();

  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState(false);
  const [canRespond, setCanRespond] = React.useState(initialCanRespond);
  const [expired, setExpired] = React.useState(false);
  const [focusNotice, setFocusNotice] = React.useState(false);
  const requestPendingRef = React.useRef(false);
  const canRespondRef = React.useRef(initialCanRespond);
  const attemptedRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [responded, setResponded] = React.useState<'accepted' | 'declined' | null>(null);
  const declineRef = React.useRef<HTMLButtonElement>(null);
  const statusRef = React.useRef<HTMLDivElement>(null);
  const noticeRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  React.useEffect(() => {
    // Dialog oddaje fokus sam (getReturnFocus); przy przyjęciu bez dialogu robimy to tutaj.
    if (responded === 'accepted') statusRef.current?.focus();
  }, [responded]);

  React.useEffect(() => {
    // Po odświeżeniu trasy serwer zna rzeczywisty wynik: odpowiedź z tej karty mogła zostać
    // zapisana mimo błędu transportu. Tylko po własnej próbie — inaczej każda przyjęta
    // wcześniej propozycja pokazywałaby komunikat sukcesu przy wejściu na stronę.
    if (!attemptedRef.current || responded !== null) return;
    if (status === 'accepted' || status === 'declined') {
      setError(false);
      setResponded(status);
    }
  }, [status, responded]);

  const showExpiredNotice = expired && responded === null && !pending;

  React.useEffect(() => {
    // Czekamy, aż komunikat faktycznie się wyrenderuje (po końcu przejścia) i dialog się zamknie.
    if (!focusNotice || confirmOpen || !showExpiredNotice) return;
    noticeRef.current?.focus();
    setFocusNotice(false);
  }, [focusNotice, confirmOpen, showExpiredNotice]);

  React.useEffect(() => {
    if (!initialCanRespond) {
      canRespondRef.current = false;
      setCanRespond(false);
      return;
    }
    if (expiresAt === null) return;

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      canRespondRef.current = false;
      setCanRespond(false);
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scheduleExpiry = () => {
      const remaining = expiresAtMs - Date.now();
      if (remaining <= 0) {
        canRespondRef.current = false;
        setCanRespond(false);
        setExpired(true);
        // Otwarte potwierdzenie bez trwającego żądania nie ma już sensu; trwające żądanie
        // dokończy się w dialogu (zamknięcie jest wtedy zablokowane — Invariant #11).
        if (!requestPendingRef.current) setConfirmOpen(false);
        onExpireRef.current?.();
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
      className="rounded-[8px] bg-success/10 px-3 py-2 text-[13px] font-medium text-success-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {successMessage}
    </div>
  ) : null;

  // Trwające żądanie zostawia (zablokowane) przyciski do wyniku, także po terminie.
  const showActions = initialCanRespond && (canRespond || pending);
  // Po odpowiedzi odświeżona trasa odbiera akcje; komunikaty zostają w tym samym miejscu drzewa,
  // więc nie są montowane od nowa i nie gubią fokusu. Otwarty dialog i błąd też utrzymują
  // komponent (#830) — wcześniej upływ terminu usuwał je bez śladu.
  if (!showActions && !successNode && !showExpiredNotice && !error && !confirmOpen) return null;

  const respond = (accept: boolean) => {
    if (pending || requestPendingRef.current || !canRespondRef.current) return;
    requestPendingRef.current = true;
    attemptedRef.current = true;
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
      if (!canRespondRef.current) {
        // Termin minął w trakcie żądania: karta ma pokazać rzeczywisty stan z serwera,
        // a fokus — wyjaśnienie, dlaczego przycisków już nie ma.
        setFocusNotice(true);
        router.refresh();
      }
    });
  };

  return (
    <div className={className}>
      {showActions ? <div className="flex min-w-0 flex-wrap items-center gap-[13px] max-[600px]:flex-col max-[600px]:items-stretch">
        <Button
          type="button"
          className={cn(BTN_PRIMARY, BTN_RESET)}
          onClick={() => respond(true)}
          disabled={pending || !canRespond}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {td('acceptProposal')}
        </Button>
        <Button
          ref={declineRef}
          type="button"
          variant="outline"
          className={cn(BTN_SECONDARY, BTN_RESET)}
          onClick={() => setConfirmOpen(true)}
          disabled={pending || !canRespond}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {td('declineProposal')}
        </Button>
      </div> : null}

      {successNode ? <div className={showActions ? 'mt-3' : undefined}>{successNode}</div> : null}

      {showExpiredNotice ? (
        <div
          ref={noticeRef}
          role="status"
          tabIndex={-1}
          className="rounded-[8px] bg-muted px-3 py-2 text-[13px] font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {td('proposalExpiredNotice')}
        </div>
      ) : null}

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
        getReturnFocus={() => statusRef.current ?? noticeRef.current ?? declineRef.current}
      />

      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={te('generic')} tone="error" onClose={() => setError(false)} />
        </div>
      ) : null}
    </div>
  );
}
