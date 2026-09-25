'use client';

import { useEffect, useRef, useState } from 'react';
import { MailX } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import {
  AuthPage,
  AuthPageHeader,
  AuthPageIcon,
  AuthPageIntro,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';
import { inspectUnsubscribeLink } from '@/lib/actions/email-unsubscribe';
import type { EmailPreferenceCategory } from '@/lib/email/categories';
import { UnsubscribeForm } from './UnsubscribeForm';

type Inspection =
  | { status: 'valid'; category: EmailPreferenceCategory }
  | { status: 'invalid' | 'expired' | 'unavailable' };

export type UnsubscribePageLabels = {
  title: string;
  invalidTitle: string;
  expiredTitle: string;
  pending: string;
  invalidText: string;
  expiredText: string;
  unavailableText: string;
  settingsHint: string;
  loginLink: string;
  confirmButton: string;
  allButton: string;
  allDoneText: string;
  doneTitle: string;
  errorText: string;
  category: Record<EmailPreferenceCategory, { confirmText: string; doneText: string }>;
};

/** Fragment nowego linku nigdy nie trafia do HTTP; stare linki z query nadal działają. */
export function UnsubscribePageContent({ locale, labels }: { locale: string; labels: UnsubscribePageLabels }) {
  const tokenRef = useRef<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);

  useEffect(() => {
    if (tokenRef.current === null) {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      tokenRef.current = fragment.get('t') ?? query.get('t') ?? '';
      query.delete('t');
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${query.size ? `?${query}` : ''}`,
      );
    }

    let active = true;
    void inspectUnsubscribeLink(tokenRef.current ?? '')
      .then((result) => { if (active) setInspection(result); })
      .catch(() => { if (active) setInspection({ status: 'unavailable' }); });
    return () => { active = false; };
  }, []);

  const category = inspection?.status === 'valid' ? labels.category[inspection.category] : null;
  const title = inspection?.status === 'invalid' ? labels.invalidTitle
    : inspection?.status === 'expired' ? labels.expiredTitle : labels.title;
  const description = inspection === null ? labels.pending
    : inspection.status === 'valid' ? category!.confirmText
      : inspection.status === 'invalid' ? labels.invalidText
        : inspection.status === 'expired' ? labels.expiredText : labels.unavailableText;

  return (
    <AuthPage>
      <AuthPageHeader>
        <AuthPageIcon>
          <MailX />
        </AuthPageIcon>
        <AuthPageTitle>{title}</AuthPageTitle>
        <AuthPageIntro>{description}</AuthPageIntro>
      </AuthPageHeader>
      <AuthPaper className="space-y-4 text-sm">
        {inspection?.status === 'valid' ? (
          <UnsubscribeForm
            token={tokenRef.current ?? ''}
            locale={locale}
            labels={{
              confirmButton: labels.confirmButton,
              allButton: labels.allButton,
              allDoneText: labels.allDoneText,
              pending: labels.pending,
              doneTitle: labels.doneTitle,
              doneText: category!.doneText,
              errorText: labels.errorText,
              invalidText: labels.invalidText,
              expiredText: labels.expiredText,
              unavailableText: labels.unavailableText,
            }}
          />
        ) : null}
        <p className="text-muted-foreground">{labels.settingsHint}</p>
        <Link href="/logowanie" className="font-medium text-primary underline-offset-4 hover:underline">
          {labels.loginLink}
        </Link>
      </AuthPaper>
    </AuthPage>
  );
}
