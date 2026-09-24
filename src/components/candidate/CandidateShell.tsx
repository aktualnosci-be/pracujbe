'use client';

import * as React from 'react';
import {
  BellRing,
  Bookmark,
  FileText,
  Heart,
  LayoutDashboard,
  MailCheck,
  MessageSquare,
  Settings,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePathname } from '@/i18n/navigation';
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/DashboardShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';

/**
 * CandidateShell — chrome panelu kandydata (makieta 04): granatowy sidebar + topbar
 * z powiadomieniami i avatarem (DashboardShell). Renderowane przez `candidate/layout.tsx`.
 *
 * WYJĄTEK: kreator onboardingu (`/candidate/onboarding/*`) ma własny lekki layout
 * (logo + Stepper) i NIE może być owinięty panelowym sidebarem. Ponieważ w App Routerze
 * layouty się zagnieżdżają, a layout onboardingu jest dzieckiem `candidate/layout`,
 * rozstrzygamy to tu po stronie klienta: dla ścieżki onboardingu przepuszczamy `children`
 * bez DashboardShell, w pozostałych przypadkach owijamy w panel.
 *
 * Dane użytkownika/powiadomień są DEMO (backend niepodpięty) — TODO(data).
 */

/** Ścieżki nawigacji panelu (bez prefiksu locale — dokłada go next-intl Link). */
const HREF = {
  summary: '/candidate',
  recommended: '/candidate/oferty-polecane',
  saved: '/candidate/zapisane',
  searches: '/candidate/wyszukiwania',
  applications: '/candidate/aplikacje',
  proposals: '/candidate/propozycje',
  messages: '/candidate/wiadomosci',
  profile: '/candidate/profil',
  settings: '/candidate/ustawienia',
} as const;

export interface CandidateShellProps {
  children: React.ReactNode;
  /** Powiadomienia z `getNotifications` (sesja/RLS albo demo w języku strony, #359). */
  notifItems?: NotificationItem[];
  /** Liczba nieprzeczytanych powiadomień (badge na dzwonku). */
  notifUnread?: number;
  notificationError?: boolean;
  /** Liczba konwersacji z nieprzeczytanymi (badge pozycji „Wiadomości"). */
  unreadMessages?: number;
  /** Nazwa zalogowanego kandydata (topbar). Puste → neutralna etykieta „Twoje konto". */
  userName?: string;
}

/** Inicjały z nazwy (max 2 litery); „•", gdy brak nazwy (P1-09: nigdy zmyślona osoba). */
function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
  return letters || '•';
}

export function CandidateShell({
  children,
  notifItems,
  notifUnread,
  notificationError,
  unreadMessages,
  userName,
}: CandidateShellProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const pathname = usePathname();

  // Onboarding ma własny (lekki) layout — nie owijaj panelem.
  if (pathname === '/candidate/onboarding' || pathname.startsWith('/candidate/onboarding/')) {
    return <>{children}</>;
  }

  const nav: DashboardNavItem[] = [
    { href: HREF.summary, label: td('navSummary'), icon: <LayoutDashboard /> },
    { href: HREF.recommended, label: td('navRecommended'), icon: <FileText /> },
    { href: HREF.saved, label: td('navSaved'), icon: <Heart /> },
    { href: HREF.searches, label: td('navSearches'), icon: <BellRing /> },
    { href: HREF.applications, label: td('navApplications'), icon: <Bookmark /> },
    { href: HREF.proposals, label: td('navProposals'), icon: <MailCheck /> },
    { href: HREF.messages, label: td('navMessages'), icon: <MessageSquare /> },
    { href: HREF.profile, label: td('navProfile'), icon: <User /> },
    { href: HREF.settings, label: td('navSettings'), icon: <Settings /> },
  ];

  // Aktywna pozycja = najdłuższy pasujący href (obsługa podstron).
  const active = nav.reduce<string>((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) return best;
    return item.href.length > best.length ? item.href : best;
  }, HREF.summary);

  // P1-09: realne dane użytkownika z sesji (layout). Bez nazwy → neutralna etykieta,
  // NIGDY zmyślona osoba („Adam Kowalski"). Powiadomienia już realne.
  const displayName = userName && userName.trim().length > 0 ? userName.trim() : td('accountLabel');
  return (
    <DashboardShell
      nav={nav}
      active={active}
      user={{ name: displayName, subtitle: td('viewProfile'), initials: initialsOf(displayName) }}
      notifications={notifUnread}
      notificationError={notificationError}
      notifItems={notifItems}
      unreadMessages={unreadMessages}
    >
      {children}
    </DashboardShell>
  );
}
