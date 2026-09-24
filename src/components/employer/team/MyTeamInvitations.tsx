'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { toUserMessageKey } from '@/lib/errors';
import { respondToTeamInvitation } from '@/lib/actions/team';
import { teamErrorKey, type TeamError } from '@/lib/team/errors';
import { roleLabelKey } from './role-keys';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTICE,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Zaproszenia do zespołów skierowane do zalogowanego (#403) — „Dołącz” / „Odrzuć”.
 * Po przyjęciu nowa firma staje się aktywna (akcja ustawia cookie), panel się odświeża.
 * Renderowane na stronie zespołu i w widoku zakładania firmy (konto bez firmy).
 */

export interface MyTeamInvitationView {
  id: string;
  companyName: string;
  role: string;
  inviterName: string;
  expiresLabel: string;
}

export function MyTeamInvitations({
  invitations,
}: {
  invitations: MyTeamInvitationView[];
}): React.JSX.Element | null {
  const t = useTranslations('team');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<TeamError | null>(null);

  if (invitations.length === 0 && !notice) return null;

  async function respond(id: string, accept: boolean): Promise<void> {
    setPending(id);
    setError(null);
    setNotice(null);
    try {
      const result = await respondToTeamInvitation(id, accept);
      if (!result.ok) setError(result.error);
      else {
        setNotice(result.demo ? t('demoNotice') : accept ? t('accepted') : t('declined'));
        if (accept && !result.demo) router.push('/employer');
        router.refresh();
      }
    } catch {
      setError('INTERNAL');
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-labelledby="my-team-invitations-title"
      className={cn(PANEL, 'space-y-3 border-primary/30')}
    >
      <h2 id="my-team-invitations-title" className={PANEL_H2}>
        {t('myInvitationsTitle')}
      </h2>
      <p role="status" aria-live="polite" className={notice ? 'text-sm text-foreground' : 'sr-only'}>
        {notice ?? ''}
      </p>
      {error ? (
        <p role="alert" className={cn(NOTICE, 'my-0 border-error/30 bg-error/10 text-error-text')}>
          {tRoot(teamErrorKey(error, toUserMessageKey))}
        </p>
      ) : null}
      <ul>
        {invitations.map((inv) => {
          const role = t(roleLabelKey(inv.role));
          return (
            <li
              key={inv.id}
              className={cn(ROW, 'flex-col sm:flex-row sm:items-center sm:justify-between')}
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-foreground">
                  {inv.inviterName
                    ? t('myInvitationFrom', { inviter: inv.inviterName, company: inv.companyName, role })
                    : t('myInvitationNoInviter', { company: inv.companyName, role })}
                </p>
                {inv.expiresLabel ? (
                  <p className={cn(ROW_META, 'mt-1')}>{inv.expiresLabel}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-[13px]">
                <Button
                  type="button"
                  className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')}
                  disabled={pending !== null}
                  aria-label={t('acceptLabel', { company: inv.companyName })}
                  onClick={() => void respond(inv.id, true)}
                >
                  {pending === inv.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {t('accept')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(BTN_SECONDARY, 'h-auto whitespace-normal')}
                  disabled={pending !== null}
                  aria-label={t('declineLabel', { company: inv.companyName })}
                  onClick={() => void respond(inv.id, false)}
                >
                  {t('decline')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
