'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { unsubscribeFromEmail } from '@/lib/actions/email-unsubscribe';
import type { UnsubscribeOutcome } from '@/lib/email/unsubscribe';

/**
 * Formularz potwierdzenia wypisania (#45): z kategorii z linku albo ze wszystkich kategorii. Teksty przychodzą z serwera (w języku strony),
 * więc wyspa nie potrzebuje wiadomości next-intl. Przycisk zablokowany podczas zapisu
 * (Invariant #11); wynik ogłaszany w regionie statusu/alertu, z fokusem na komunikacie.
 */
export function UnsubscribeForm({
  token,
  locale,
  labels,
}: {
  token: string;
  /** Język strony — trafia do dowodu wycofania zgody. */
  locale: string;
  labels: {
    confirmButton: string;
    allButton: string;
    allDoneText: string;
    pending: string;
    doneTitle: string;
    doneText: string;
    errorText: string;
    invalidText: string;
    expiredText: string;
    unavailableText: string;
  };
}) {
  const [state, action, pending] = useActionState<UnsubscribeOutcome | null, FormData>(
    unsubscribeFromEmail,
    null,
  );
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state) messageRef.current?.focus();
  }, [state]);

  if (state?.status === 'done') {
    return (
      <div ref={messageRef} tabIndex={-1} role="status" className="space-y-2 outline-none">
        <h2 className="text-lg font-semibold text-foreground">{labels.doneTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {state.scope === 'all' ? labels.allDoneText : labels.doneText}
        </p>
      </div>
    );
  }

  const failure =
    state === null
      ? null
      : {
          invalid: labels.invalidText,
          expired: labels.expiredText,
          unavailable: labels.unavailableText,
          error: labels.errorText,
        }[state.status];

  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="t" value={token} />
      <input type="hidden" name="l" value={locale} />
      {failure ? (
        <div
          ref={messageRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {failure}
        </div>
      ) : null}
      <Button type="submit" name="scope" value="category" className="w-full" disabled={pending}>
        {pending ? labels.pending : labels.confirmButton}
      </Button>
      <Button
        type="submit"
        name="scope"
        value="all"
        variant="outline"
        className="w-full"
        disabled={pending}
      >
        {labels.allButton}
      </Button>
    </form>
  );
}
