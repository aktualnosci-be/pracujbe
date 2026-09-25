'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { AuthForm } from '@/components/auth/AuthForm';
import { useLinkToken } from '@/components/auth/use-link-token';
import { roleLabelKey } from '@/components/employer/team/role-keys';
import { previewTeamInvitationSignup } from '@/lib/actions/team-invite-signup';
import type { TeamInvitationSignupPreview } from '@/lib/team/invite-signup';

/**
 * Wejście do rejestracji pracodawcy (0108). Zwykły adres → zwykły formularz (także bez JS).
 * Link z e-maila zaproszenia do zespołu (`#token=…`, token usuwany z adresu przez
 * `useLinkToken`) → podgląd zaproszenia (Server Action, token tylko w pamięci) i formularz
 * bez nazwy firmy, z adresem z zaproszenia. Link zużyty/nieważny → komunikat i zwykła
 * rejestracja.
 */
type State = { kind: 'plain' } | { kind: 'checking' } | { kind: 'preview'; token: string; preview: TeamInvitationSignupPreview };

export function EmployerSignupEntry(): React.JSX.Element {
  const t = useTranslations('team');
  const token = useLinkToken();
  const [state, setState] = React.useState<State>({ kind: 'plain' });

  React.useEffect(() => {
    if (!token) return;
    let active = true;
    setState({ kind: 'checking' });
    previewTeamInvitationSignup(token)
      .then((preview) => {
        if (active) setState({ kind: 'preview', token, preview });
      })
      .catch(() => {
        if (active) setState({ kind: 'preview', token, preview: { status: 'invalid' } });
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state.kind === 'checking') {
    return (
      <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {t('signup.checking')}
      </p>
    );
  }

  if (state.kind === 'preview' && state.preview.status === 'valid') {
    const { preview } = state;
    return (
      <div className="space-y-6">
        <div role="status" className="space-y-2 rounded-md border border-border bg-soft p-4 text-sm text-foreground">
          <p className="font-medium">
            {t('signup.intro', { company: preview.companyName, role: t(roleLabelKey(preview.role)) })}
          </p>
          <p>{t('signup.nextSteps')}</p>
          <p className="text-muted-foreground">{t('signup.emailFixed')}</p>
        </div>
        <AuthForm variant="registerInvitedEmployer" invitation={{ token: state.token, email: preview.email }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {state.kind === 'preview' ? (
        <p role="alert" className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text">
          {state.preview.status === 'used' ? t('signup.used') : t('signup.invalid')}
        </p>
      ) : null}
      <AuthForm variant="registerEmployer" />
    </div>
  );
}
