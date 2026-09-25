'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { BellOff } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { inspectAlertOffLink, turnOffSavedSearchAlert } from '@/lib/actions/saved-search-alert-off';
import type { AlertOffOutcome } from '@/lib/email/saved-search-alert-off';

type Inspection = { status: 'valid' | 'invalid' | 'expired' | 'unavailable' };

export type AlertOffPageLabels = {
  title: string;
  confirmText: string;
  confirmButton: string;
  pending: string;
  doneTitle: string;
  doneText: string;
  settingsHint: string;
  loginLink: string;
  invalidTitle: string;
  invalidText: string;
  expiredTitle: string;
  expiredText: string;
  unavailableText: string;
  errorText: string;
};

/**
 * Strona `/wypisz-alert` (#100). Token czytany z fragmentu URL (nie trafia do HTTP ani logów)
 * i od razu usuwany z paska adresu. GET tylko weryfikuje podpis; wyłączenie wymaga kliknięcia.
 * Przycisk zablokowany podczas zapisu, wynik w regionie `status`/`alert` z fokusem (Invariant #11).
 */
export function AlertOffPageContent({ labels }: { labels: AlertOffPageLabels }) {
  const tokenRef = useRef<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [state, action, pending] = useActionState<AlertOffOutcome | null, FormData>(
    turnOffSavedSearchAlert,
    null,
  );
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tokenRef.current === null) {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      tokenRef.current = fragment.get('t') ?? '';
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    let active = true;
    void inspectAlertOffLink(tokenRef.current ?? '')
      .then((result) => { if (active) setInspection(result); })
      .catch(() => { if (active) setInspection({ status: 'unavailable' }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (state) messageRef.current?.focus();
  }, [state]);

  const title = inspection?.status === 'invalid' ? labels.invalidTitle
    : inspection?.status === 'expired' ? labels.expiredTitle : labels.title;
  const description = inspection === null ? labels.pending
    : inspection.status === 'valid' ? labels.confirmText
      : inspection.status === 'invalid' ? labels.invalidText
        : inspection.status === 'expired' ? labels.expiredText : labels.unavailableText;
  const failure = state === null || state.status === 'done' ? null : {
    invalid: labels.invalidText,
    expired: labels.expiredText,
    unavailable: labels.unavailableText,
    error: labels.errorText,
  }[state.status];

  return (
    <Card>
      <CardHeader className="items-center space-y-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
          <BellOff className="h-7 w-7" />
        </span>
        <CardTitle as="h1" className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-center text-sm">
        {inspection?.status === 'valid' ? (
          state?.status === 'done' ? (
            <div ref={messageRef} tabIndex={-1} role="status" className="space-y-2 outline-none">
              <h2 className="text-lg font-semibold text-foreground">{labels.doneTitle}</h2>
              <p className="text-sm text-muted-foreground">{labels.doneText}</p>
            </div>
          ) : (
            <form action={action} className="space-y-4" aria-busy={pending}>
              <input type="hidden" name="t" value={tokenRef.current ?? ''} />
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
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? labels.pending : labels.confirmButton}
              </Button>
            </form>
          )
        ) : null}
        <p className="text-muted-foreground">{labels.settingsHint}</p>
        <Link href="/logowanie" className="font-medium text-primary underline-offset-4 hover:underline">
          {labels.loginLink}
        </Link>
      </CardContent>
    </Card>
  );
}
