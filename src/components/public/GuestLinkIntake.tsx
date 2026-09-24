'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { stageGuestLink } from '@/lib/actions/guest-link';
import { isGuestLinkToken, type GuestLinkPurpose } from '@/lib/guest-apply/link-state';

/** Removes the fragment before any token is sent by POST to a server action. */
export function GuestLinkIntake({
  locale,
  purpose,
  hasToken,
  children,
}: {
  locale: string;
  purpose: GuestLinkPurpose;
  hasToken: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('guestApply');
  const [state, setState] = useState<'checking' | 'invalid' | 'ready'>('checking');
  const pending = useRef(false);
  useEffect(() => {
    function intake() {
      const hash = window.location.hash;
      if (!hash) {
        if (!pending.current) setState(hasToken ? 'ready' : 'invalid');
        return;
      }
      pending.current = true;
      setState('checking');
      const fragment = new URLSearchParams(hash.slice(1));
      const token = fragment.get('token');
      window.history.replaceState(window.history.state, '', window.location.pathname);
      if (!isGuestLinkToken(token)) {
        pending.current = false;
        setState('invalid');
        return;
      }
      void stageGuestLink(locale, purpose, token).then((staged) => {
        if (staged) window.location.replace(window.location.pathname);
        else {
          pending.current = false;
          setState('invalid');
        }
      }).catch(() => {
        pending.current = false;
        setState('invalid');
      });
    }
    intake();
    window.addEventListener('hashchange', intake);
    return () => window.removeEventListener('hashchange', intake);
  }, [hasToken, locale, purpose]);

  return state === 'invalid' ? (
    <div role="alert">
      <h2 className="text-xl font-semibold">{t('invalidTitle')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('invalidBody')}</p>
    </div>
  ) : state === 'ready' ? children : (
    <p role="status" className="text-sm text-muted-foreground">{t('openingLink')}</p>
  );
}
