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
import { SessionKeepAlive } from '@/components/auth/SessionKeepAlive';
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/DashboardShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import {
  CANDIDATE_NAV_HREF as HREF,
  candidateNavKeys,
  isOnboardingPath,
  type CandidateNavKey,
} from '@/lib/candidate-nav';

/**
 * CandidateShell — chrome panelu kandydata (makieta 04): jasny sidebar `.side-item` + topbar
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
  /** Prawdziwa sesja Better Auth (layout) — dołącza `SessionKeepAlive` (#864). */
  keepSessionAlive?: boolean;
  /**
   * Tryb produktu z serwera (`isRecruitmentEnabled()`, #1128) — komponent kliencki nie liczy go
   * sam. Domyślnie `false` = tryb ogłoszeniowy (fail-closed): bez pozycji rekrutacyjnych.
   */
  recruitmentEnabled?: boolean;
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
  keepSessionAlive,
  recruitmentEnabled = false,
}: CandidateShellProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const pathname = usePathname();

  // Onboarding ma własny (lekki) layout — nie owijaj panelem. #1142: w trybie ogłoszeniowym
  // kreatora nie ma (404), więc strona błędu renderuje się w zwykłym panelu.
  if (recruitmentEnabled && isOnboardingPath(pathname)) {
    return (
      <>
        {keepSessionAlive ? <SessionKeepAlive /> : null}
        {children}
      </>
    );
  }

  // #1142: jedno źródło listy pozycji zależnej od trybu (`candidateNavKeys`). Tryb ogłoszeniowy
  // (domyślny, fail-closed): pulpit, zapisane oferty, zapisane wyszukiwania, ustawienia.
  const items: Record<CandidateNavKey, Omit<DashboardNavItem, 'href'>> = {
    summary: { label: td('navSummary'), icon: <LayoutDashboard /> },
    recommended: { label: td('navRecommended'), icon: <FileText /> },
    saved: { label: td('navSaved'), icon: <Heart /> },
    searches: { label: td('navSearches'), icon: <BellRing /> },
    applications: { label: td('navApplications'), icon: <Bookmark /> },
    proposals: { label: td('navProposals'), icon: <MailCheck /> },
    messages: { label: td('navMessages'), icon: <MessageSquare /> },
    profile: { label: td('navProfile'), icon: <User /> },
    settings: { label: td('navSettings'), icon: <Settings /> },
  };
  const nav: DashboardNavItem[] = candidateNavKeys(recruitmentEnabled).map((key) => ({
    href: HREF[key],
    ...items[key],
  }));

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
      user={{
        name: displayName,
        // #1142: bez profilu zawodowego w trybie ogłoszeniowym — bez podpisu „Zobacz profil”.
        subtitle: recruitmentEnabled ? td('viewProfile') : undefined,
        initials: initialsOf(displayName),
      }}
      notifications={notifUnread}
      notificationError={notificationError}
      notifItems={notifItems}
      unreadMessages={unreadMessages}
      notificationsHref="/candidate/powiadomienia"
    >
      {keepSessionAlive ? <SessionKeepAlive /> : null}
      {children}
    </DashboardShell>
  );
}
