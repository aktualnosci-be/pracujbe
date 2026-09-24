'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { loginHref, registerHref } from '@/lib/auth/next-path';
import { claimGuestApplication } from '@/lib/actions/guest-applications';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * Przejęcie aplikacji gościa przez konto (#98). Zalogowany kandydat klika przycisk; bez sesji
 * (także gdy wygaśnie w trakcie) widzi logowanie/rejestrację z powrotem na tę stronę.
 * `returnTo` = bieżąca ścieżka z tokenem (po rejestracji link z e-maila potwierdzenia wraca tu).
 */
export function GuestClaimPanel({
  token,
  returnTo,
  signedIn,
}: {
  token: string;
  returnTo: string;
  signedIn: boolean;
}): React.JSX.Element {
  const t = useTranslations('guestApply');
  const tRoot = useTranslations();
  const [pending, setPending] = React.useState(false);
  const [claimed, setClaimed] = React.useState(false);
  const [needsLogin, setNeedsLogin] = React.useState(!signedIn);
  const [error, setError] = React.useState<ErrorCode | 'network' | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (claimed) headingRef.current?.focus();
  }, [claimed]);
  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const claim = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await claimGuestApplication(token);
      if (res.ok) setClaimed(true);
      else if (res.error === 'UNAUTHENTICATED') setNeedsLogin(true);
      else setError(res.error);
    } catch {
      setError('network');
    } finally {
      setPending(false);
    }
  };

  if (claimed) {
    return (
      <div role="status" className="space-y-4" data-testid="guest-claim-result">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-success-text outline-none">
          {t('claimedTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('claimedBody')}</p>
        <Link href="/candidate/aplikacje" className={cn(buttonVariants(), 'min-h-12')}>
          {t('viewApplications')}
        </Link>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('claimLoginPrompt')}</p>
        <div className="flex flex-col gap-3">
          <Link href={loginHref(returnTo)} className={cn(buttonVariants(), 'min-h-12')}>
            {t('claimLogin')}
          </Link>
          <Link href={registerHref(returnTo)} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-12')}>
            {t('claimRegister')}
          </Link>
        </div>
      </div>
    );
  }

  const message = (code: ErrorCode | 'network'): string => {
    switch (code) {
      case 'network':
        return tRoot('apply.errorNetwork');
      case 'NOT_FOUND':
        return t('claimNotFound');
      case 'PERMISSION_DENIED':
        return tRoot('apply.candidateOnly');
      default:
        return tRoot(toUserMessageKey(code));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('claimIntro')}</p>
      {error ? (
        <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg bg-error/10 p-3 text-sm text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {message(error)}
        </div>
      ) : null}
      <Button type="button" className="min-h-12 w-full" onClick={claim} disabled={pending} aria-busy={pending || undefined}>
        {pending ? t('claiming') : t('claimButton')}
      </Button>
    </div>
  );
}
