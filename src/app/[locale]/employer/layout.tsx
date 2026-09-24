import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmployerShell, type EmployerShellMode } from '@/components/employer/EmployerShell';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/sentry';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';
import { getEmployerShellData } from '@/lib/data/employer';
import { getMyTeamInvitations } from '@/lib/data/team';
import { getTranslations } from 'next-intl/server';
import type { CompanySwitcherCompany } from '@/components/employer/CompanySwitcher';

/**
 * Layout panelu pracodawcy (grupa tras `/employer/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: granatowy sidebar z przełącznikiem firmy
 * + topbar) poprzez kliencki `EmployerShell`.
 *
 * GUARD: przy skonfigurowanej bazie i sesjach (`isPortalDataConfigured`) wymaga (1) zalogowanego użytkownika oraz
 * (2) aktywnego członkostwa w firmie (`company_members.is_active = true`). Brak sesji →
 * /logowanie. Konto pracodawcy bez firmy (np. nieudany bootstrap po rejestracji — #365) →
 * zamiast strony formularz zakładania firmy (CompanyOnboarding), nie rejestracja nowego
 * konta; inne role bez firmy → /rejestracja-pracodawca. Błąd odczytu członkostwa → chrome
 * z komunikatem i ponowieniem (bez treści strony). Bez env → tryb demo (panel na danych
 * DEMO). `force-dynamic`, bo guard zależy od sesji.
 *
 * Layout pozostaje serwerowy, aby wyeksportować NOINDEX dla całego poddrzewa panelu
 * (Invariant #9) — metadata dziedziczy się do stron.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EmployerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  let notifItems: NotificationItem[] | undefined;
  let notifUnread: number | undefined;
  let notificationError = false;
  let unreadMessages: number | undefined;
  let companies: CompanySwitcherCompany[] | undefined;
  let activeCompanyId: string | null | undefined;
  let activeCompanyName: string | undefined;
  let userName: string | undefined;
  let mode: EmployerShellMode = 'demo';

  if (isPortalDataConfigured()) {
    let me: Awaited<ReturnType<typeof getPortalIdentity>>;
    try {
      me = await getPortalIdentity();
    } catch (error) {
      // Awaria odczytu sesji/profilu ≠ brak sesji: chrome z ponowieniem, nie przekierowanie.
      captureError(error, { area: 'employer.layout.identity' });
      return <EmployerShell mode="error">{null}</EmployerShell>;
    }
    if (!me) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `me` dla TS
    }

    // Aktywne członkostwo w firmie jest wymagane, by wejść do panelu pracodawcy.
    // RLS (pod sesją) pozwala czytać własny wiersz (profile_id = auth.uid()). Użytkownik może
    // należeć do wielu firm — LIMIT 1 wystarcza do potwierdzenia dostępu.
    let hasMembership: boolean;
    try {
      const memberships = await withPortalTransaction(me, (tx) =>
        queryRows(tx, 'employer-layout.membership',
          `SELECT id FROM public.company_members
            WHERE profile_id = $1 AND is_active = true
            LIMIT 1`, [me.id]));
      hasMembership = memberships.length > 0;
    } catch (error) {
      captureError(error, { area: 'employer.layout.membership' });
      return <EmployerShell mode="error">{null}</EmployerShell>;
    }
    if (!hasMembership) {
      // Rola pochodzi z profilu w bazie (getPortalIdentity) — bez drugiego odczytu.
      if (me.role !== 'employer') {
        redirect({ href: '/rejestracja-pracodawca', locale: locale as Locale });
      }
      // #403: zaproszenia do zespołów (błąd odczytu nie blokuje zakładania własnej firmy).
      const mine = await getMyTeamInvitations();
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
        <EmployerShell mode="ok">
          <CompanyOnboarding
            // Nazwa firmy z formularza rejestracji leży w auth.users (poza zasięgiem roli
            // authenticated) — formularz startuje pusty (#25).
            defaultName=""
            invitations={invitations}
          />
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
    >
      {children}
    </EmployerShell>
  );
}
