'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useLinkToken } from '@/components/auth/use-link-token';
import { confirmEmail } from '@/lib/actions/auth';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';

/**
 * Przycisk potwierdzenia adresu (#24). Token z fragmentu linku (`useLinkToken`), wysyłany dopiero
 * po kliknięciu. Sukces = przekierowanie z akcji (panel wg roli albo zapamiętana oferta), więc
 * komponent pokazuje tylko stan zapisu i błąd. Blokada przycisku w trakcie (Invariant #11),
 * fokus na komunikacie błędu.
 */
export function ConfirmEmailForm(): React.JSX.Element {
  const t = useTranslations('auth');
  const tRoot = useTranslations();
  const tCommon = useTranslations('common');
  const token = useLinkToken();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<ErrorCode | null>(null);
  const alertRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (error) alertRef.current?.focus({ preventScroll: true });
  }, [error]);

  async function onConfirm() {
    if (!token || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await confirmEmail(token);
      // Na sukcesie akcja przekierowuje (NEXT_REDIRECT) i tu nie wracamy.
      if (result && !result.ok) setError(result.error);
    } catch (e) {
      // Przekierowanie Next.js jest przekazywane dalej; każdy inny wyjątek = błąd ogólny.
      if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
      setError('INTERNAL');
    } finally {
      setPending(false);
    }
  }

  const failure = token === null ? t('linkMissing') : error ? tRoot(toUserMessageKey(error)) : null;

  return (
    <div className="space-y-4">
      {failure ? (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{failure}</p>
        </div>
      ) : null}

      {token !== null ? (
        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={onConfirm}
          disabled={token === undefined || pending}
          aria-busy={pending || undefined}
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{tCommon('loading')}</span>
            </>
          ) : (
            <span>{t('confirmEmailSubmit')}</span>
          )}
        </Button>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">{t('confirmEmailExpiredHint')}</p>
      <div className="text-center text-sm">
        <Link href="/logowanie" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('backToLogin')}
        </Link>
      </div>
    </div>
  );
}
