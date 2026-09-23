import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmployerShell } from '@/components/employer/EmployerShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';
import { getEmployerShellData } from '@/lib/data/employer';
import type { CompanySwitcherCompany } from '@/components/employer/CompanySwitcher';

/**
 * Layout panelu pracodawcy (grupa tras `/employer/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: granatowy sidebar z przełącznikiem firmy
 * + topbar) poprzez kliencki `EmployerShell`.
 *
 * GUARD: przy skonfigurowanym Supabase wymaga (1) zalogowanego użytkownika oraz
 * (2) aktywnego członkostwa w firmie (`company_members.is_active = true`). Brak sesji →
 * /logowanie; sesja bez firmy → /rejestracja-pracodawca (założenie firmy). Bez env →
 * tryb demo (przepuszczamy, panel na danych DEMO). `force-dynamic`, bo guard zależy od sesji.
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
    const { data: memberships } = await supabase
      .from('company_members')
      .select('id')
      .eq('profile_id', user.id)
      .eq('is_active', true)
      .limit(1);
    if (!memberships || memberships.length === 0) {
      redirect({ href: '/rejestracja-pracodawca', locale: locale as Locale });
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
    if (shell) {
      companies = shell.companies;
      activeCompanyId = shell.activeId;
      activeCompanyName = shell.activeName;
      userName = shell.userName;
    }
  }

  return (
    <EmployerShell
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
