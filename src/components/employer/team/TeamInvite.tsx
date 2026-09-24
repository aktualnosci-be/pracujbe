'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toUserMessageKey } from '@/lib/errors';
import { inviteTeamMember, revokeTeamInvitation } from '@/lib/actions/team';
import { teamErrorKey, type TeamError } from '@/lib/team/errors';
import { assignableRoles, canManageRole } from '@/lib/team/permissions';
import { teamInviteSchema, type TeamInviteInput } from '@/lib/validation/team';
import { roleLabelKey } from './role-keys';

/**
 * Zaproszenie do zespołu + lista oczekujących zaproszeń (#403).
 *
 * Formularz: RHF + ten sam schemat Zod co akcja (Invariant #11: blokada podczas zapisu,
 * błędy przy polach, fokus na pierwszym błędzie, dane zostają po błędzie, jasny sukces).
 * Odpowiedź po wysłaniu jest taka sama bez względu na to, czy adres ma konto.
 */

export interface TeamInvitationView {
  id: string;
  email: string;
  role: string;
  expiresLabel: string;
}

const controlClass =
  'min-h-12 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function TeamInvite({
  actorRole,
  invitations,
}: {
  actorRole: string;
  invitations: TeamInvitationView[];
}): React.JSX.Element {
  const t = useTranslations('team');
  const tRoot = useTranslations();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<TeamError | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const roles = assignableRoles(actorRole).filter((r) => r !== 'owner');
  const resolver = React.useMemo(() => zodResolver(teamInviteSchema) as Resolver<TeamInviteInput>, []);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TeamInviteInput>({
    resolver,
    defaultValues: { email: '', role: (roles.includes('recruiter') ? 'recruiter' : roles[0]) ?? 'member' },
    mode: 'onSubmit',
  });

  const errorText = (error: TeamError) => tRoot(teamErrorKey(error, toUserMessageKey));

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setNotice(null);
    try {
      const result = await inviteTeamMember(values);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      setNotice(result.demo ? t('demoNotice') : t('invited'));
      reset({ email: '', role: values.role });
      router.refresh();
    } catch {
      setServerError('INTERNAL');
    }
  });

  async function revoke(id: string): Promise<void> {
    setRevoking(id);
    setServerError(null);
    setNotice(null);
    try {
      const result = await revokeTeamInvitation(id);
      if (!result.ok) setServerError(result.error);
      else {
        setNotice(result.demo ? t('demoNotice') : t('revoked'));
        router.refresh();
      }
    } catch {
      setServerError('INTERNAL');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className={notice ? 'rounded-md border border-success/30 bg-success/10 p-3 text-sm text-foreground' : 'sr-only'}>
        {notice ?? ''}
      </p>
      {serverError ? (
        <p role="alert" className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text">
          {errorText(serverError)}
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="team-invite-email">{t('emailLabel')}</Label>
          <Input
            id="team-invite-email"
            type="email"
            autoComplete="off"
            placeholder={t('emailPlaceholder')}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'team-invite-email-error' : undefined}
            {...register('email')}
          />
          {errors.email?.message ? (
            <p id="team-invite-email-error" className="text-sm text-error-text">
              {tRoot(String(errors.email.message))}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="team-invite-role">{t('roleLabel')}</Label>
          <select
            id="team-invite-role"
            className={controlClass}
            aria-invalid={errors.role ? true : undefined}
            aria-describedby={errors.role ? 'team-invite-role-error' : undefined}
            {...register('role')}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(roleLabelKey(r))}
              </option>
            ))}
          </select>
          {errors.role?.message ? (
            <p id="team-invite-role-error" className="text-sm text-error-text">
              {tRoot(String(errors.role.message))}
            </p>
          ) : null}
        </div>
        <Button type="submit" className="min-h-12" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isSubmitting ? t('saving') : t('inviteSubmit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">{t('inviteNoAccountHint')}</p>

      <section aria-labelledby="team-invitations-title" className="space-y-3">
        <h3 id="team-invitations-title" className="text-base font-semibold text-foreground">
          {t('invitationsTitle')}
        </h3>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('invitationsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all font-medium text-foreground">{inv.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(roleLabelKey(inv.role))}
                    {inv.expiresLabel ? ` · ${inv.expiresLabel}` : ''}
                  </p>
                </div>
                {canManageRole(actorRole, inv.role) ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12 self-start sm:self-auto"
                    disabled={revoking !== null}
                    aria-label={t('revokeLabel', { email: inv.email })}
                    onClick={() => void revoke(inv.id)}
                  >
                    {revoking === inv.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                    {t('revoke')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
