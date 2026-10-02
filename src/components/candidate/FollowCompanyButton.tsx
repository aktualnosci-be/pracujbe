'use client';

import * as React from 'react';
import { BellPlus, BellRing, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import {
  followCompanyAction,
  getCompanyFollowState,
  unfollowCompanyAction,
  type CompanyFollowState,
} from '@/lib/actions/saved-searches';
import { loginHref } from '@/lib/auth/next-path';
import { toUserMessageKey } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * „Obserwuj firmę” na publicznym profilu (#855). Strona jest ISR i nie czyta sesji — stan
 * (gość / kandydat obserwuje albo nie) pobiera wyspa po załadowaniu, jak zapis oferty. Gość widzi
 * link do logowania, pracodawca nic. Alerty o nowych ofertach firmy idą tym samym torem co zapisane
 * wyszukiwania (kanał, zgody, pauza, wypisanie); firma nie widzi, kto ją obserwuje.
 */
export interface FollowCompanyLabels {
  follow: string;
  following: string;
  followed: string;
  unfollowed: string;
  login: string;
  stateError: string;
  networkError: string;
}

/**
 * Teksty przychodzą z serwera (strona profilu) jako `labels` — przestrzeń `companyProfile` zostaje
 * poza payloadem `NextIntlClientProvider` każdej strony (`src/i18n/client-messages.ts`).
 */
export function FollowCompanyButton({
  companyId,
  companySlug,
  labels: t,
}: {
  companyId: string;
  /** Adres profilu — po zalogowaniu gość wraca na tę stronę. */
  companySlug: string;
  labels: FollowCompanyLabels;
}): React.JSX.Element | null {
  const tRoot = useTranslations();
  const locale = useLocale();
  const [state, setState] = React.useState<CompanyFollowState | null>(null);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    getCompanyFollowState(companyId)
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setState({ status: 'error' }); });
    return () => { active = false; };
  }, [companyId]);

  if (state === null || state.status === 'unavailable') return null;

  if (state.status !== 'candidate') {
    if (state.status === 'error') {
      return <p role="alert" className="mt-3 text-sm text-error-text">{t.stateError}</p>;
    }
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        <Link
          href={loginHref(`/${locale}/pracodawcy/${companySlug}`)}
          className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline"
        >
          {t.login}
        </Link>
      </p>
    );
  }

  const following = state.following;
  const toggle = async () => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = following ? await unfollowCompanyAction(companyId) : await followCompanyAction(companyId, locale);
      if (res.ok) {
        setState({ status: 'candidate', following: !following });
        setMessage({ tone: 'ok', text: following ? t.unfollowed : t.followed });
      } else if (res.error === 'UNAUTHENTICATED') {
        setState({ status: 'anonymous' }); // sesja wygasła — link logowania
      } else {
        setMessage({ tone: 'error', text: tRoot(toUserMessageKey(res.error)) });
      }
    } catch {
      setMessage({ tone: 'error', text: t.networkError });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        aria-pressed={following}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-[11px] border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60',
          following
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-[color:var(--pp-line-btn)] bg-card text-foreground hover:bg-soft',
        )}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : following ? (
          <BellRing className="h-4 w-4" aria-hidden="true" />
        ) : (
          <BellPlus className="h-4 w-4" aria-hidden="true" />
        )}
        {following ? t.following : t.follow}
      </button>
      <p
        role={message?.tone === 'error' ? 'alert' : 'status'}
        className={cn('mt-2 text-sm', message?.tone === 'error' ? 'text-error-text' : 'text-foreground')}
      >
        {message?.text ?? ''}
      </p>
    </div>
  );
}
