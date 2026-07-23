'use client';

import * as React from 'react';
import { Check, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { sendOffer } from '@/lib/actions/offers';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';

/**
 * SendOfferButton — wysłanie propozycji do dopasowanego kandydata (panel pracodawcy).
 *
 * Woła idempotentną Server Action `sendOffer` (RPC `send_offer`: walidacja verified/active/
 * członkostwa + niezależny outbox e-mail w języku ODBIORCY — Invarianty #1/#3). `idempotencyKey`
 * generowany JEDNORAZOWO na instancję (useRef) — powtórne kliknięcia trafiają w ten sam klucz,
 * więc DB zwraca istniejącą propozycję (brak duplikatu). Przycisk zablokowany w trakcie wysyłki
 * (useTransition), po sukcesie oznaczony jako wysłany; błędy → toast z komunikatem i18n.
 */

const TOAST_MS = 4000;

export interface SendOfferButtonProps {
  jobId: string;
  candidateId: string;
  className?: string;
}

export function SendOfferButton({
  jobId,
  candidateId,
  className,
}: SendOfferButtonProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const ts = useTranslations('status');
  const tRoot = useTranslations();

  const [pending, startTransition] = React.useTransition();
  const [sent, setSent] = React.useState(false);
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Stały klucz idempotencyjny na instancję przycisku (ochrona przed duplikatem propozycji).
  // Leniwa inicjalizacja — crypto.randomUUID() woływane raz, nie przy każdym renderze.
  const idempotencyKeyRef = React.useRef<string>('');
  if (idempotencyKeyRef.current === '') {
    idempotencyKeyRef.current = crypto.randomUUID();
  }
  const router = useRouter();

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleClick = () => {
    if (pending || sent) return;
    // Brak identyfikatorów (np. tryb DEMO) — nie wołamy akcji, pokazujemy błąd zamiast wyjątku.
    if (!jobId || !candidateId) {
      setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
      return;
    }
    startTransition(async () => {
      try {
        const res = await sendOffer({
          jobId,
          candidateId,
          message: td('offerDefaultMessage'),
          idempotencyKey: idempotencyKeyRef.current,
        });
        if (res.ok) {
          setSent(true);
          setToast({ tone: 'success', message: td('offerSentSuccess') });
          router.refresh();
        } else {
          setToast({ tone: 'error', message: tRoot(toUserMessageKey(res.error as ErrorCode)) });
        }
      } catch {
        setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={sent ? 'outline' : 'default'}
        disabled={pending || sent}
        onClick={handleClick}
        className={className}
      >
        {sent ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Send className="size-4" aria-hidden="true" />
        )}
        {sent ? ts('offerSent') : td('sendOffer')}
      </Button>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </>
  );
}
