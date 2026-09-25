'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  confirmGuestApplication,
  type GuestConfirmOutcome,
} from '@/lib/actions/guest-applications';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * Potwierdzenie aplikacji gościa (#98). Link z e-maila otwiera stronę z przyciskiem — dopiero
 * kliknięcie (POST Server Action) potwierdza adres, więc skaner linków w poczcie nie wyśle
 * aplikacji za użytkownika. Wynik: komunikat z nagłówkiem (fokus) i dalsze kroki.
 */

const TITLES: Record<GuestConfirmOutcome, string> = {
  confirmed: 'confirmedTitle',
  already_confirmed: 'alreadyConfirmedTitle',
  duplicate: 'duplicateTitle',
  expired: 'expiredTitle',
  job_closed: 'jobClosedTitle',
  invalid: 'invalidTitle',
};
const BODIES: Record<GuestConfirmOutcome, string> = {
  confirmed: 'confirmedBody',
  already_confirmed: 'alreadyConfirmedBody',
  duplicate: 'duplicateBody',
  expired: 'expiredBody',
  job_closed: 'jobClosedBody',
  invalid: 'invalidBody',
};

export function GuestConfirmPanel(): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslations('guestApply');
  const tRoot = useTranslations();
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ outcome: GuestConfirmOutcome; jobSlug?: string } | null>(null);
  const [error, setError] = React.useState<ErrorCode | 'network' | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (result) headingRef.current?.focus();
  }, [result]);
  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await confirmGuestApplication(locale);
      if (res.ok) setResult({ outcome: res.outcome, jobSlug: res.jobSlug });
      else setError(res.error);
    } catch {
      setError('network');
    } finally {
      setPending(false);
    }
  };

  if (result) {
    const success = result.outcome === 'confirmed' || result.outcome === 'already_confirmed';
    return (
      <div role="status" className="space-y-4" data-testid="guest-confirm-result">
        <h2 ref={headingRef} tabIndex={-1} className={cn('text-xl font-semibold outline-none', success ? 'text-success-text' : 'text-foreground')}>
          {t(TITLES[result.outcome])}
        </h2>
        <p className="text-sm text-muted-foreground">{t(BODIES[result.outcome])}</p>
        <div className="flex flex-wrap gap-3">
          {result.jobSlug ? (
            <Link href={`/oferty-pracy/${result.jobSlug}`} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-12')}>
              {t('viewJob')}
            </Link>
          ) : null}
          <Link href="/oferty-pracy" className={cn(buttonVariants(), 'min-h-12')}>
            {t('browseJobs')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('confirmIntro')}</p>
      {error ? (
        <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg bg-error/10 p-3 text-sm text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {error === 'network'
            ? tRoot('apply.errorNetwork')
            : error === 'GUEST_APPLY_UNAVAILABLE'
              ? t('unavailable')
              : tRoot(toUserMessageKey(error))}
        </div>
      ) : null}
      <Button type="button" className="w-full" size="passport" onClick={confirm} disabled={pending} aria-busy={pending || undefined}>
        {pending ? t('confirming') : t('confirmButton')}
      </Button>
    </div>
  );
}
