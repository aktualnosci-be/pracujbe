'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { stageGuestLink } from '@/lib/actions/guest-link';
import { isGuestLinkToken, type GuestLinkPurpose } from '@/lib/guest-apply/link-state';

/** Removes the fragment before any token is sent by POST to a server action. */
export function GuestLinkIntake({ locale, purpose }: { locale: string; purpose: GuestLinkPurpose }) {
  const t = useTranslations('guestApply');
  const [invalid, setInvalid] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get('token');
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (!isGuestLinkToken(token)) {
      setInvalid(true);
      return;
    }
    void stageGuestLink(locale, purpose, token).then((staged) => {
      if (staged) window.location.replace(window.location.pathname);
      else setInvalid(true);
    }).catch(() => setInvalid(true));
  }, [locale, purpose]);

  return invalid ? (
    <div role="alert">
      <h2 className="text-xl font-semibold">{t('invalidTitle')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('invalidBody')}</p>
    </div>
  ) : (
    <p role="status" className="text-sm text-muted-foreground">{t('openingLink')}</p>
  );
}
