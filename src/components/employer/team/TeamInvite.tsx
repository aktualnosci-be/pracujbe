'use client';

import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { isLocale, localeNames, routing } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toUserMessageKey } from '@/lib/errors';
import { inviteTeamMember, revokeTeamInvitation } from '@/lib/actions/team';
import { teamErrorKey, type TeamError } from '@/lib/team/errors';
import { assignableRoles, canManageRole } from '@/lib/team/permissions';
import { teamInviteSchema, type TeamInviteInput } from '@/lib/validation/team';
import { roleLabelKey } from './role-keys';
import {
  BTN_PRIMARY,
  BTN_SMALL,
  FORM_CONTROL,
  FORM_LABEL,
  NOTICE,
  PANEL_P,
  ROW,
  ROW_META,
  ROW_TITLE,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Zaproszenie do zespołu + lista oczekujących zaproszeń (#403).
 *
 * Formularz: RHF + ten sam schemat Zod co akcja (Invariant #11: blokada podczas zapisu,
 * błędy przy polach, fokus na pierwszym błędzie, dane zostają po błędzie, jasny sukces).
 * Odpowiedź po wysłaniu jest taka sama bez względu na to, czy adres ma konto.
 *
 * Język zaproszenia (0108): domyślnie język strony zapraszającego. Decyduje o języku e-maila
 * tylko dla adresu bez konta (brak profilu odbiorcy, Invariant #1); konto z profilem dostaje
 * e-mail w swoim języku.
 */

export interface TeamInvitationView {
  id: string;
  email: string;
  role: string;
  expiresLabel: string;
}

const controlClass = FORM_CONTROL;

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
  const pageLocale = useLocale();
  const defaultLocale = isLocale(pageLocale) ? pageLocale : routing.defaultLocale;
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
    defaultValues: {
      email: '',
      role: (roles.includes('recruiter') ? 'recruiter' : roles[0]) ?? 'member',
      locale: defaultLocale,
    },
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
      setNotice(result.demo ? t('demoNotice') : t('invitedSent'));
      reset({ email: '', role: values.role, locale: values.locale });
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
      <p role="status" aria-live="polite" className={notice ? cn(NOTICE, 'my-0 border-success/30 bg-success/10 text-foreground') : 'sr-only'}>
        {notice ?? ''}
      </p>
      {serverError ? (
        <p role="alert" className={cn(NOTICE, 'my-0 border-error/30 bg-error/10 text-error-text')}>
          {errorText(serverError)}
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,11rem)_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-[9px]">
          <Label htmlFor="team-invite-email" className={FORM_LABEL}>{t('emailLabel')}</Label>
          <Input
            className={FORM_CONTROL}
            id="team-invite-email"
            type="email"
            autoComplete="off"
            placeholder={t('emailPlaceholder')}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'team-invite-email-error' : undefined}
            {...register('email')}
          />
          {errors.email?.message ? (
            <p id="team-invite-email-error" className="text-[13px] text-error-text">
              {tRoot(String(errors.email.message))}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-[9px]">
          <Label htmlFor="team-invite-role" className={FORM_LABEL}>{t('roleLabel')}</Label>
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
            <p id="team-invite-role-error" className="text-[13px] text-error-text">
              {tRoot(String(errors.role.message))}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-[9px]">
          <Label htmlFor="team-invite-locale" className={FORM_LABEL}>{t('localeLabel')}</Label>
          <select
            id="team-invite-locale"
            className={controlClass}
            aria-invalid={errors.locale ? true : undefined}
            aria-describedby={errors.locale ? 'team-invite-locale-error team-invite-locale-hint' : 'team-invite-locale-hint'}
            {...register('locale')}
          >
            {routing.locales.map((code) => (
              <option key={code} value={code} lang={code}>
                {localeNames[code]}
              </option>
            ))}
          </select>
          {errors.locale?.message ? (
            <p id="team-invite-locale-error" className="text-[13px] text-error-text">
              {tRoot(String(errors.locale.message))}
            </p>
          ) : null}
        </div>
        <Button type="submit" className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')} disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isSubmitting ? t('saving') : t('inviteSubmit')}
        </Button>
      </form>
      <p id="team-invite-locale-hint" className={PANEL_P}>{t('inviteLinkHint')}</p>

      <section aria-labelledby="team-invitations-title" className="space-y-3">
        <h3 id="team-invitations-title" className={ROW_TITLE}>
          {t('invitationsTitle')}
        </h3>
        {invitations.length === 0 ? (
          <p className={PANEL_P}>{t('invitationsEmpty')}</p>
        ) : (
          <ul className="border-t border-border pt-[25px] max-[600px]:pt-[22px]">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className={cn(ROW, 'flex-col sm:flex-row sm:items-center sm:justify-between')}
              >
                <div className="min-w-0">
                  <p className={cn(ROW_TITLE, 'break-all')}>{inv.email}</p>
                  <p className={ROW_META}>
                    {t(roleLabelKey(inv.role))}
                    {inv.expiresLabel ? ` · ${inv.expiresLabel}` : ''}
                  </p>
                </div>
                {canManageRole(actorRole, inv.role) ? (
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(BTN_SMALL, 'h-auto whitespace-normal border-border text-foreground hover:bg-soft self-start sm:self-auto')}
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
