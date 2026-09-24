import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmployerShell, type EmployerShellMode } from '@/components/employer/EmployerShell';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';
import { getEmployerShellData } from '@/lib/data/employer';
import { getMyTeamInvitations } from '@/lib/data/team';
import { getTranslations } from 'next-intl/server';
import type { CompanySwitcherCompany } from '@/components/employer/CompanySwitcher';

/**
 * Layout panelu pracodawcy (grupa tras `/employer/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: jasny sidebar `.side-item` z przełącznikiem firmy
 * + topbar) poprzez kliencki `EmployerShell`.
 *
 * GUARD: przy skonfigurowanym Supabase wymaga (1) zalogowanego użytkownika oraz
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

  if (isSupabaseConfigured()) {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `user` dla TS
    }

    // Aktywne członkostwo w firmie jest wymagane, by wejść do panelu pracodawcy.
    // RLS pozwala czytać własny wiersz (profile_id = auth.uid()). Użytkownik może
    // należeć do wielu firm — limit(1) wystarcza do potwierdzenia dostępu.
    const { data: memberships, error: membershipError } = await supabase
      .from('company_members')
      .select('id')
      .eq('profile_id', user.id)
      .eq('is_active', true)
      .limit(1);
    if (membershipError || !Array.isArray(memberships)) {
      return <EmployerShell mode="error">{null}</EmployerShell>;
    }
    if (memberships.length === 0) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) return <EmployerShell mode="error">{null}</EmployerShell>;
      if ((profile as { role?: string } | null)?.role !== 'employer') {
        redirect({ href: '/rejestracja-pracodawca', locale: locale as Locale });
      }
      const rawName = (user.user_metadata as Record<string, unknown> | undefined)?.['company_name'];
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
            defaultName={typeof rawName === 'string' ? rawName.trim() : ''}
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
