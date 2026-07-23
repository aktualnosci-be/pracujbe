'use client';

import * as React from 'react';
import {
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
  applications: '/candidate/aplikacje',
  proposals: '/candidate/propozycje',
  messages: '/candidate/wiadomosci',
  profile: '/candidate/profil',
  settings: '/candidate/ustawienia',
} as const;

export interface CandidateShellProps {
  children: React.ReactNode;
  /** Realne powiadomienia (z sesji/RLS). Bez nich DashboardShell użyje fallbacku DEMO. */
  notifItems?: NotificationItem[];
  /** Liczba nieprzeczytanych powiadomień (badge na dzwonku). */
  notifUnread?: number;
  /** Liczba konwersacji z nieprzeczytanymi (badge pozycji „Wiadomości"). */
  unreadMessages?: number;
}

export function CandidateShell({
  children,
  notifItems,
  notifUnread,
  unreadMessages,
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

  // TODO(data): realne dane użytkownika z sesji/backendu (powiadomienia już realne).
  return (
    <DashboardShell
      nav={nav}
      active={active}
      user={{ name: 'Adam Kowalski', subtitle: td('viewProfile'), initials: 'AK' }}
      notifications={notifUnread}
      notifItems={notifItems}
      unreadMessages={unreadMessages}
    >
      {children}
    </DashboardShell>
  );
}
