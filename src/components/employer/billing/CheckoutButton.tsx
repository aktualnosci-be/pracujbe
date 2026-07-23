'use client';

import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { useRouter } from '@/i18n/navigation';
import { startCheckout } from '@/lib/actions/billing';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';

/**
 * CheckoutButton — wybór pakietu (panel pracodawcy → płatności, Etap 7h scaffold).
 *
 * Woła PROVIDER-GATED server action `startCheckout`. Bez dostawcy płatności akcja zwraca
 * `{ ok: true, demo: true }` → pokazujemy toast „płatności w przygotowaniu". Gdy w przyszłości
 * dostawca zwróci `url`, przekierujemy do sesji płatności. Przycisk zablokowany w trakcie
 * (useTransition); dla bieżącego pakietu renderujemy nieaktywny stan „Twój plan".
 */

const TOAST_MS = 4000;

export interface CheckoutButtonProps {
  plan: string;
  /** Wyróżniony pakiet → wariant „default" (granatowy); inaczej „outline". */
  recommended?: boolean;
  /** Bieżący pakiet firmy → przycisk nieaktywny z etykietą „Twój plan". */
  isCurrent?: boolean;
  className?: string;
}

export function CheckoutButton({
  plan,
  recommended,
  isCurrent,
  className,
}: CheckoutButtonProps): React.JSX.Element {
  const t = useTranslations('billing');
  const tRoot = useTranslations();

  const [pending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );
  const router = useRouter();

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleClick = () => {
    if (pending || isCurrent) return;
    startTransition(async () => {
      try {
        const res = await startCheckout(plan);
        if (res.ok) {
          if (res.url) {
            window.location.assign(res.url);
            return;
          }
          // Tryb demo (brak dostawcy) — informujemy, że rozliczenia są w przygotowaniu.
          setToast({ tone: 'success', message: t('checkoutDemo') });
          router.refresh();
        } else {
          setToast({ tone: 'error', message: tRoot(toUserMessageKey(res.error as ErrorCode)) });
        }
      } catch {
        setToast({ tone: 'error', message: tRoot(toUserMessageKey('INTERNAL')) });
      }
    });
  };

  if (isCurrent) {
    return (
      <Button type="button" variant="outline" disabled className={className}>
        <Check className="size-4" aria-hidden="true" />
        {t('currentPlanBadge')}
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant={recommended ? 'default' : 'outline'}
        disabled={pending}
        onClick={handleClick}
        className={className}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {t('choosePlan')}
      </Button>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </>
  );
}
