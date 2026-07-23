'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { useRouter } from '@/i18n/navigation';
import { cancelSubscription } from '@/lib/actions/billing';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';

/**
 * CancelSubscriptionButton — anulowanie subskrypcji (panel pracodawcy → płatności, Etap 7h).
 *
 * Woła PROVIDER-GATED server action `cancelSubscription`. Bez dostawcy płatności akcja zwraca
 * `{ ok: true, demo: true }` → toast „anulowanie w przygotowaniu". Przycisk zablokowany w trakcie
 * (useTransition); błędy → toast z komunikatem i18n.
 */

const TOAST_MS = 4000;

export function CancelSubscriptionButton({
  className,
}: {
  className?: string;
}): React.JSX.Element {
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
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await cancelSubscription();
        if (res.ok) {
          setToast({ tone: 'success', message: t('cancelDemo') });
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
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={handleClick}
        className={className}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {t('cancelSubscription')}
      </Button>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </>
  );
}
