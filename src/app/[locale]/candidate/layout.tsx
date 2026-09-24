import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CandidateShell } from '@/components/candidate/CandidateShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { PortalIdentity } from '@/lib/auth/session';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne } from '@/lib/db/sql';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';

/**
 * Layout panelu kandydata (grupa tras `/candidate/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: jasny sidebar `.side-item` + topbar) poprzez
 * kliencki `CandidateShell`, który — dla ścieżek kreatora onboardingu — świadomie
 * przepuszcza treść bez sidebara (kreator ma własny lekki layout).
 *
 * GUARD: przy skonfigurowanej bazie wymaga (1) zalogowanego użytkownika (`getPortalIdentity`) —
 * brak sesji → redirect na /logowanie; (2) roli kandydata — pracodawca trafiający na panel
 * kandydata → redirect do /employer (symetria z guardem panelu pracodawcy), administrator →
 * /admin. Kandydat przed onboardingiem przechodzi. Bez env → tryb demo.
 * `force-dynamic`, bo guard zależy od sesji.
 *
 * NOINDEX dla całego poddrzewa panelu (Invariant #9): metadata dziedziczy się do stron
 * i podlayoutów, o ile nie zostanie nadpisana.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Imię i nazwisko z własnego profilu (pod sesją). Błąd → brak nazwy (neutralna etykieta). */
async function readUserName(me: PortalIdentity): Promise<string | undefined> {
  try {
    const row = await withPortalTransaction(me, (tx) => queryOne<{ first_name: unknown; last_name: unknown }>(
      tx, 'candidate.shell-name', 'SELECT first_name, last_name FROM public.profiles WHERE id = $1', [me.id]));
    const first = typeof row?.first_name === 'string' ? row.first_name : '';
    const last = typeof row?.last_name === 'string' ? row.last_name : '';
    const fullName = `${first} ${last}`.trim();
    return fullName.length > 0 ? fullName : undefined;
  } catch {
    return undefined;
  }
}

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

  if (isPortalDataConfigured()) {
    // Tożsamość z sesji serwera (aktywny profil, potwierdzony e-mail, rola z bazy) — rola
    // jest już sprawdzona, nie czytamy jej drugi raz.
    const me = await getPortalIdentity();
    if (!me) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `me` dla TS
    }
    // Pracodawca → jego panel; administrator → panel admina. Twarda granica roli kandydata
    // jest w RPC (ensure_candidate_profile/apply_to_job, P1-04).
    if (me.role === 'employer') {
      redirect({ href: '/employer', locale: locale as Locale });
    }
    if (me.role === 'admin') {
      redirect({ href: '/admin', locale: locale as Locale });
    }

    // P1-09: realna nazwa kandydata (topbar), bez zmyślonej „Adam Kowalski". Odczyt własnego
    // profilu pod sesją (RLS: self-select); awaria odczytu = brak nazwy, nie błąd panelu.
    userName = await readUserName(me);

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
