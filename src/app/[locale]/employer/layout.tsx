import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmployerShell, type EmployerShellMode } from '@/components/employer/EmployerShell';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import { RevokedCompanyAccess } from '@/components/employer/RevokedCompanyAccess';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentIdentity, type PortalIdentity } from '@/lib/auth/current';
import { readSignupCompanyName } from '@/lib/auth/signup-company-name';
import { getDomainPool } from '@/lib/db/runtime';
import { withUserTransaction } from '@/lib/db/transaction';
import { isPortalAuthConfigured } from '@/lib/env';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';
import { getEmployerShellData } from '@/lib/data/employer';
import { getMyTeamInvitations } from '@/lib/data/team';
import { getRevokedCompanyNames } from '@/lib/data/revoked-company-access';
import { getTranslations } from 'next-intl/server';
import type { CompanySwitcherCompany } from '@/components/employer/CompanySwitcher';

/**
 * Layout panelu pracodawcy (grupa tras `/employer/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: jasny sidebar `.side-item` z przełącznikiem firmy
 * + topbar) poprzez kliencki `EmployerShell`.
 *
 * GUARD (#24): przy skonfigurowanych kontach wymaga (1) zweryfikowanej sesji serwerowej
 * (`getCurrentIdentity`) oraz (2) aktywnego członkostwa w firmie (`company_members.is_active`,
 * odczyt pod RLS z UUID sesji). Brak sesji → /logowanie. Konto pracodawcy bez firmy (np.
 * nieudany bootstrap po potwierdzeniu adresu — #365) → formularz zakładania firmy
 * (CompanyOnboarding); konto z samymi odebranymi członkostwami (#1210) → komunikat o odebranym
 * dostępie + zaproszenia + własna firma przez `create_additional_company` (RevokedCompanyAccess);
 * inne role bez firmy → /rejestracja-pracodawca. Błąd odczytu członkostwa →
 * chrome z komunikatem i ponowieniem (bez treści strony). Bez konfiguracji kont → tryb demo
 * (panel na danych DEMO). `force-dynamic`, bo guard zależy od sesji.
 *
 * Layout pozostaje serwerowy, aby wyeksportować NOINDEX dla całego poddrzewa panelu
 * (Invariant #9) — metadata dziedziczy się do stron.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type MembershipState = 'active' | 'revoked' | 'none';

/**
 * Stan członkostw osoby (RLS: własne wiersze): `active` = co najmniej jedno aktywne,
 * `revoked` = są wyłącznie nieaktywne (dostęp odebrany, #1210), `none` = brak. `null` = błąd.
 */
async function membershipState(identity: PortalIdentity): Promise<MembershipState | null> {
  try {
    return await withUserTransaction(await getDomainPool(), identity.id, async (tx) => {
      const result = (await tx.query(
        `SELECT EXISTS (SELECT 1 FROM public.company_members WHERE profile_id = $1 AND is_active = true) AS member,
                EXISTS (SELECT 1 FROM public.company_members WHERE profile_id = $1 AND is_active = false) AS revoked`,
        [identity.id],
      )) as { rows: { member: boolean; revoked?: boolean }[] };
      const row = result.rows[0];
      if (row?.member === true) return 'active';
      return row?.revoked === true ? 'revoked' : 'none';
    });
  } catch {
    return null;
  }
}

export default async function EmployerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // #1133: tryb produktu z serwera — shell (kliencki) dostaje go w propsach.
  const recruitmentEnabled = isRecruitmentEnabled('candidateSearch');

  let notifItems: NotificationItem[] | undefined;
  let notifUnread: number | undefined;
  let notificationError = false;
  let unreadMessages: number | undefined;
  let companies: CompanySwitcherCompany[] | undefined;
  let activeCompanyId: string | null | undefined;
  let activeCompanyName: string | undefined;
  let userName: string | undefined;
  let mode: EmployerShellMode = 'demo';
  // #864: prawdziwa sesja Better Auth (nie demo) — panel dostaje `SessionKeepAlive`.
  let hasSession = false;

  if (isPortalAuthConfigured()) {
    const identity = await getCurrentIdentity();
    if (!identity) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ dla TS
    }
    hasSession = true;

    // Aktywne członkostwo w firmie jest wymagane, by wejść do panelu pracodawcy.
    const state = await membershipState(identity);
    if (state === null) {
      return (
        <EmployerShell mode="error" keepSessionAlive={hasSession} recruitmentEnabled={recruitmentEnabled}>
          {null}
        </EmployerShell>
      );
    }
    if (state !== 'active') {
      if (identity.role !== 'employer') {
        redirect({ href: '/rejestracja-pracodawca', locale: locale as Locale });
      }
      // #403: zaproszenia do zespołów (błąd odczytu nie blokuje zakładania własnej firmy).
      // #365: nazwa firmy z rejestracji (metadane konta) wypełnia formularz domyślnie.
      const revoked = state === 'revoked';
      const [mine, defaultName, revokedNames] = await Promise.all([
        getMyTeamInvitations(),
        revoked ? Promise.resolve('') : readSignupCompanyName(identity),
        revoked ? getRevokedCompanyNames(identity.id) : Promise.resolve([] as string[]),
      ]);
      const tTeam = await getTranslations({ locale, namespace: 'team' });
      const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Europe/Brussels' });
      const invitations = (mine.status === 'ok' ? mine.invitations : []).map((inv) => {
        const date = new Date(inv.expiresAt);
        return {
          ...inv,
          expiresLabel: Number.isNaN(date.getTime())
            ? ''
            : tTeam('expiresOn', { date: dateFmt.format(date) }),
        };
      });
      return (
        <EmployerShell mode="ok" keepSessionAlive={hasSession} recruitmentEnabled={recruitmentEnabled}>
          {revoked ? (
            // #1210: `create_first_company` odmawia kontu z odebranym dostępem — własna firma
            // idzie ścieżką `create_additional_company`, a komunikat mówi, co się stało.
            <RevokedCompanyAccess companyNames={revokedNames} invitations={invitations} />
          ) : (
            <CompanyOnboarding defaultName={defaultName} invitations={invitations} />
          )}
        </EmployerShell>
      );
    }

    // Realne powiadomienia + licznik nieprzeczytanych konwersacji + kontekst firmy (FUN-07).
    const [notif, unread, shell] = await Promise.all([
      getNotifications(locale),
      getUnreadConversationsCount(),
      getEmployerShellData(),
    ]);
    notificationError = notif.status === 'error';
    notifItems = (notif.status === 'ready' ? notif.items : []).map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.meta,
      unread: item.unread,
      href: item.href,
    }));
    notifUnread = notif.status === 'ready' ? notif.unread : undefined;
    unreadMessages = unread;
    mode = shell.status === 'ok' ? 'ok' : 'error';
    if (shell.status === 'ok') {
      companies = shell.companies;
      activeCompanyId = shell.activeId;
      activeCompanyName = shell.activeName;
      userName = shell.userName;
    }
  } else {
    // Tryb demo (#359): to samo źródło co realne powiadomienia — tytuły z i18n, czas przez
    // `Intl.RelativeTimeFormat` w języku strony, cele linków wg roli panelu.
    const notif = await getNotifications(locale, 'employer');
    if (notif.status === 'ready') {
      notifItems = notif.items;
      notifUnread = notif.unread;
    }
  }

  return (
    <EmployerShell
      mode={mode}
      notifItems={notifItems}
      notifUnread={notifUnread}
      notificationError={notificationError}
      unreadMessages={unreadMessages}
      companies={companies}
      activeCompanyId={activeCompanyId}
      activeCompanyName={activeCompanyName}
      userName={userName}
      keepSessionAlive={hasSession}
      recruitmentEnabled={recruitmentEnabled}
    >
      {children}
    </EmployerShell>
  );
}
