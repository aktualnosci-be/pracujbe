'use client';

import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { openConversation } from '@/lib/actions/messages';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * MessageCandidateButton — „Napisz wiadomość" ze szczegółu zgłoszenia (#300).
 *
 * Woła istniejącą Server Action `openConversation({ applicationId })` (RPC
 * `get_or_create_conversation`, idempotentne — ponowne kliknięcie zwraca tę samą rozmowę)
 * i przechodzi do wątku w `/employer/wiadomosci?c=…`. Przycisk zablokowany w trakcie
 * (Invariant #11); błąd → komunikat i18n (Invariant #8).
 */

const TOAST_MS = 4000;

export function MessageCandidateButton({
  applicationId,
  candidateName,
}: {
  applicationId: string;
  candidateName: string;
}): React.JSX.Element {
  const td = useTranslations('dashboard');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const onClick = () => {
    startTransition(async () => {
      try {
        const res = await openConversation({ applicationId });
        if (res.ok) {
          router.push(res.id === 'demo' ? '/employer/wiadomosci' : `/employer/wiadomosci?c=${encodeURIComponent(res.id)}`);
        } else {
          setError(tRoot(toUserMessageKey(res.error as ErrorCode)));
        }
      } catch {
        setError(tRoot(toUserMessageKey('INTERNAL')));
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
        aria-label={td('employerApplicationMessageLabel', { name: candidateName })}
        className={cn(BTN_SECONDARY, 'h-auto whitespace-normal')}
      >
        <MessageSquare aria-hidden="true" />
        {td('employerApplicationMessage')}
      </Button>
      {error ? (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm">
          <Toast message={error} tone="error" onClose={() => setError(null)} />
        </div>
      ) : null}
    </>
  );
}
