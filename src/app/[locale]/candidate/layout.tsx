import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CandidateShell } from '@/components/candidate/CandidateShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';

/**
 * Layout panelu kandydata (grupa tras `/candidate/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: granatowy sidebar + topbar) poprzez
 * kliencki `CandidateShell`, który — dla ścieżek kreatora onboardingu — świadomie
 * przepuszcza treść bez sidebara (kreator ma własny lekki layout).
 *
 * GUARD: przy skonfigurowanym Supabase wymaga (1) zalogowanego użytkownika (getUser) —
 * brak sesji → redirect na /logowanie; (2) roli innej niż `employer` — pracodawca trafiający
 * na panel kandydata → redirect do /employer (symetria z guardem panelu pracodawcy, który
 * odsyła użytkownika bez firmy). Kandydat/admin/rola nieustalona → przepuszczamy (nie
 * blokujemy świeżo zarejestrowanego kandydata przed onboardingiem). Bez env → tryb demo.
 * `force-dynamic`, bo guard zależy od sesji.
 *
 * NOINDEX dla całego poddrzewa panelu (Invariant #9): metadata dziedziczy się do stron
 * i podlayoutów, o ile nie zostanie nadpisana.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CandidateLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  let notifItems: NotificationItem[] | undefined;
  let notifUnread: number | undefined;
  let unreadMessages: number | undefined;

  if (isSupabaseConfigured()) {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `user` dla TS
    }

    // Pracodawca nie ma czego szukać w panelu kandydata — odsyłamy do jego panelu.
    // Odczyt własnej roli pod sesją (RLS: self-select). Rolę 'candidate'/'admin'/nieustaloną
    // przepuszczamy (świeży kandydat przed onboardingiem nie może zostać zablokowany).
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const role = ((profileRow ?? {}) as Record<string, unknown>)['role'];
    // Pracodawca → jego panel; administrator → panel admina. Rolę 'candidate'/nieustaloną
    // przepuszczamy (świeży kandydat przed onboardingiem nie może zostać zablokowany).
    // Twarda granica roli kandydata jest w RPC (ensure_candidate_profile/apply_to_job, P1-04).
    if (role === 'employer') {
      redirect({ href: '/employer', locale: locale as Locale });
    }
    if (role === 'admin') {
      redirect({ href: '/admin', locale: locale as Locale });
    }

    // Realne powiadomienia + licznik nieprzeczytanych konwersacji (pod sesją/RLS).
    const [notif, unread] = await Promise.all([
      getNotifications(locale),
      getUnreadConversationsCount(),
    ]);
    notifItems = notif.items.map((item) => ({
      title: item.title,
      meta: item.meta,
      unread: item.unread,
    }));
    notifUnread = notif.unread;
    unreadMessages = unread;
  }

  return (
    <CandidateShell
      notifItems={notifItems}
      notifUnread={notifUnread}
      unreadMessages={unreadMessages}
    >
      {children}
    </CandidateShell>
  );
}
