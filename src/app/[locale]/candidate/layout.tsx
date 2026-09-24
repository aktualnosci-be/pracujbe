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
 * Owija strony w chrome panelu (DashboardShell: jasny sidebar `.side-item` + topbar) poprzez
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
  let notificationError = false;
  let unreadMessages: number | undefined;
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

    // Pracodawca nie ma czego szukać w panelu kandydata — odsyłamy do jego panelu.
    // Odczyt własnej roli + nazwy pod sesją (RLS: self-select). Rolę 'candidate'/'admin'/
    // nieustaloną przepuszczamy (świeży kandydat przed onboardingiem nie może zostać zablokowany).
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();
    const role = ((profileRow ?? {}) as Record<string, unknown>)['role'];
    // P1-09: realna nazwa kandydata (topbar), bez zmyślonej „Adam Kowalski".
    const pr = (profileRow ?? {}) as Record<string, unknown>;
    const first = typeof pr['first_name'] === 'string' ? pr['first_name'] : '';
    const last = typeof pr['last_name'] === 'string' ? pr['last_name'] : '';
    const fullName = `${first} ${last}`.trim();
    userName = fullName.length > 0 ? fullName : undefined;
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
  } else {
    // Tryb demo (#359): to samo źródło co realne powiadomienia — tytuły z i18n, czas przez
    // `Intl.RelativeTimeFormat` w języku strony, cele linków wg roli panelu.
    const notif = await getNotifications(locale, 'candidate');
    if (notif.status === 'ready') {
      notifItems = notif.items;
      notifUnread = notif.unread;
    }
  }

  return (
    <CandidateShell
      notifItems={notifItems}
      notifUnread={notifUnread}
      notificationError={notificationError}
      unreadMessages={unreadMessages}
      userName={userName}
    >
      {children}
    </CandidateShell>
  );
}
