'use client';

import { useHydrated } from '@/components/forms/use-hydrated';
import { NoScriptFormNotice } from '@/components/forms/NoScriptFormNotice';
import * as React from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { isLocale, localeNames, routing, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toUserMessageKey } from '@/lib/errors';
import { inviteTeamMember, renewTeamInvitation, revokeTeamInvitation } from '@/lib/actions/team';
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
import { Alert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

/**
 * Zaproszenie do zespołu + lista oczekujących zaproszeń (#403).
 *
 * Formularz: RHF + ten sam schemat Zod co akcja (Invariant #11: blokada podczas zapisu,
 * błędy przy polach, fokus na pierwszym błędzie, dane zostają po błędzie, jasny sukces).
 * Odpowiedź po wysłaniu jest taka sama bez względu na to, czy adres ma konto.
 *
 * Język zaproszenia (0121): domyślnie język strony zapraszającego. Decyduje o języku e-maila
 * tylko dla adresu bez konta (brak profilu odbiorcy, Invariant #1); konto z profilem dostaje
 * e-mail w swoim języku.
 *
 * Oczekujące zaproszenia (0187): rola, ważność, język zaproszenia, kto i kiedy zaprosił.
 * „Odnów” = kolejne 14 dni i nowy link dla adresu bez konta (adres, rola i język z bazy);
 * „Cofnij” wymaga potwierdzenia w dialogu (link w e-mailu przestaje działać). Jedna operacja
 * naraz; po sukcesie fokus na komunikacie `role="status"` (wiersz może zniknąć).
 */

export interface TeamInvitationView {
  id: string;
  email: string;
  role: string;
  expiresLabel: string;
  /** Data utworzenia w języku strony (pusty tekst, gdy nieznana). */
  createdLabel: string;
  /** Kod języka zaproszenia (`null` — zaproszenie sprzed wyboru języka). */
  locale: Locale | null;
  inviterName: string;
}

const controlClass = FORM_CONTROL;

export interface TeamInviteProps {
  /** Firma, dla której wyrenderowano formularz — zaproszenie nie trafi do innej aktywnej (EMP-02). */
  companyId: string;
  actorRole: string;
  invitations: TeamInvitationView[];
}

/**
 * CC25-01: `useForm` czyta `defaultValues` tylko przy montażu. Po przełączeniu aktywnej firmy
 * w pasku bocznym TEJ SAMEJ karty (`router.refresh`) RSC podaje nowe `companyId` i wartości,
 * ale bez klucza komponent zostałby w drzewie ze starymi polami — a zapis poszedłby już do
 * nowej firmy. Klucz = firma: formularz montuje się od nowa z danymi właściwej firmy.
 */
export function TeamInvite(props: TeamInviteProps): React.JSX.Element {
  return <TeamInviteFields key={props.companyId} {...props} />;
}

function TeamInviteFields({ companyId, actorRole, invitations }: TeamInviteProps): React.JSX.Element {
  const hydrated = useHydrated();
  const t = useTranslations('team');
  const tRoot = useTranslations();
  const router = useRouter();
  const pageLocale = useLocale();
  const defaultLocale = isLocale(pageLocale) ? pageLocale : routing.defaultLocale;
  const [serverError, setServerError] = React.useState<TeamError | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<TeamInvitationView | null>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);

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
      const result = await inviteTeamMember(values, companyId);
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

  async function runInvitation(
    id: string,
    action: (invitationId: string) => Promise<Awaited<ReturnType<typeof revokeTeamInvitation>>>,
    successText: string,
  ): Promise<boolean> {
    if (pendingId !== null) return false;
    setPendingId(id);
    setServerError(null);
    setNotice(null);
    try {
      const result = await action(id);
      if (!result.ok) {
        setServerError(result.error);
        return false;
      }
      setNotice(result.demo ? t('demoNotice') : successText);
      router.refresh();
      return true;
    } catch {
      setServerError('INTERNAL');
      return false;
    } finally {
      setPendingId(null);
    }
  }

  function invitationMeta(inv: TeamInvitationView): string {
    const language = inv.locale ? localeNames[inv.locale] : null;
    const parts = [
      language ? t('invitationLanguage', { language }) : t('invitationLanguageUnknown'),
    ];
    if (inv.createdLabel) {
      parts.push(
        inv.inviterName
          ? t('invitationSentBy', { name: inv.inviterName, date: inv.createdLabel })
          : t('invitationSentOn', { date: inv.createdLabel }),
      );
    }
    return parts.join(' · ');
  }

  return (
    <div className="space-y-6">
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className={notice ? cn(NOTICE, 'my-0 border-success/30 bg-success/10 text-foreground') : 'sr-only'}>
        {notice ?? ''}
      </p>
      {serverError ? (
        <Alert variant="error">
          {errorText(serverError)}
        </Alert>
      ) : null}

      <form method="post" onSubmit={onSubmit} noValidate className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,11rem)_auto] sm:items-end">
        <NoScriptFormNotice />
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
        <Button type="submit" className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')} disabled={isSubmitting || !hydrated}>
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
                  <p className={ROW_META}>{invitationMeta(inv)}</p>
                </div>
                {canManageRole(actorRole, inv.role) ? (
                  <div className="flex flex-wrap gap-2 self-start sm:self-auto">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(BTN_SMALL, 'h-auto whitespace-normal border-border text-foreground hover:bg-soft')}
                      disabled={pendingId !== null}
                      aria-busy={pendingId === inv.id && confirmRevoke === null ? true : undefined}
                      aria-label={t('renewLabel', { email: inv.email })}
                      onClick={() =>
                        void runInvitation(inv.id, (id) => renewTeamInvitation(id, companyId), t('renewed')).then((ok) => {
                          if (ok) statusRef.current?.focus();
                        })
                      }
                    >
                      {pendingId === inv.id && confirmRevoke === null ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {t('renew')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(BTN_SMALL, 'h-auto whitespace-normal border-border text-foreground hover:bg-soft')}
                      disabled={pendingId !== null}
                      aria-label={t('revokeLabel', { email: inv.email })}
                      onClick={() => setConfirmRevoke(inv)}
                    >
                      {t('revoke')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRevoke(null);
        }}
        title={confirmRevoke ? t('revokeTitle', { email: confirmRevoke.email }) : ''}
        description={t('revokeDesc')}
        confirmLabel={t('revokeConfirm')}
        cancelLabel={tRoot('common.cancel')}
        pending={confirmRevoke !== null && pendingId === confirmRevoke.id}
        getReturnFocus={() => statusRef.current}
        onConfirm={() => {
          const target = confirmRevoke;
          if (!target) return;
          void runInvitation(target.id, revokeTeamInvitation, t('revoked')).then(() =>
            setConfirmRevoke(null),
          );
        }}
      />
    </div>
  );
}
