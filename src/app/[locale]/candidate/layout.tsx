import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CandidateShell } from '@/components/candidate/CandidateShell';
import { FunnelMinorMarker } from '@/components/candidate/FunnelMinorMarker';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { displayName, getCurrentIdentity, readOwnProfileSummary } from '@/lib/auth/current';
import { isPortalAuthConfigured } from '@/lib/env';
import { getNotifications } from '@/lib/data/notifications';
import { getUnreadConversationsCount } from '@/lib/data/messages';
import { loadMyAgeAttestation } from '@/lib/data/age-policy';

/**
 * Layout panelu kandydata (grupa tras `/candidate/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: jasny sidebar `.side-item` + topbar) poprzez
 * kliencki `CandidateShell`, który — dla ścieżek kreatora onboardingu — świadomie
 * przepuszcza treść bez sidebara (kreator ma własny lekki layout).
 *
 * GUARD (#24): przy skonfigurowanych kontach PostgreSQL wymaga zweryfikowanej sesji serwerowej
 * (`getCurrentIdentity`: cookie Better Auth → aktywny profil, potwierdzony e-mail). Brak sesji →
 * /logowanie; pracodawca → /employer, administrator → /admin (rola z profilu, nie z cookie).
 * Awaria odczytu sesji rzuca (granica błędu), nie wpuszcza jako gościa ani innej roli.
 * Bez konfiguracji kont → tryb demo. `force-dynamic`, bo guard zależy od sesji.
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
  // #576: konto 16–17 → lejek ofert wyłączony na tym urządzeniu; nieznany stan → bez zmian.
  let knownMinor: boolean | undefined;

  if (isPortalAuthConfigured()) {
    const identity = await getCurrentIdentity();
    if (!identity) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ dla TS
    }
    // Pracodawca → jego panel; administrator → panel admina. Twarda granica roli kandydata
    // jest dodatkowo w RPC (ensure_candidate_profile/apply_to_job, P1-04).
    if (identity.role === 'employer') {
      redirect({ href: '/employer', locale: locale as Locale });
    }
    if (identity.role === 'admin') {
      redirect({ href: '/admin', locale: locale as Locale });
    }
    // P1-09: realna nazwa kandydata (topbar), bez zmyślonej „Adam Kowalski".
    userName = displayName(await readOwnProfileSummary(identity));

    // Realne powiadomienia + licznik nieprzeczytanych konwersacji (pod sesją/RLS).
    const [notif, unread, age] = await Promise.all([
      getNotifications(locale),
      getUnreadConversationsCount(),
      loadMyAgeAttestation().catch(() => null),
    ]);
    if (age?.status === 'ready' && !age.demo && age.attestedMinAge !== null) {
      knownMinor = !age.isAdult;
    }
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
      {knownMinor !== undefined ? <FunnelMinorMarker minor={knownMinor} /> : null}
      {children}
    </CandidateShell>
  );
}
