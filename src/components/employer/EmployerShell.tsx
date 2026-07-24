'use client';

import * as React from 'react';
import {
  Building2,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePathname } from '@/i18n/navigation';
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/DashboardShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { CompanySwitcher, type CompanySwitcherCompany } from '@/components/employer/CompanySwitcher';

/**
 * EmployerShell — chrome panelu pracodawcy (makieta 05): granatowy sidebar z REALNYM
 * przełącznikiem firmy (FUN-07) + topbar z powiadomieniami i danymi użytkownika. Renderowane
 * przez `employer/layout.tsx` (serwerowy, ustawia NOINDEX). Dane firmy/użytkownika pochodzą
 * z sesji (props); bez env layout podaje fallback demo.
 */

/** Ścieżki nawigacji panelu (bez prefiksu locale — dokłada go next-intl Link). */
const HREF = {
  summary: '/employer',
  offers: '/employer/oferty',
  candidates: '/employer/kandydaci',
  applications: '/employer/aplikacje',
  messages: '/employer/wiadomosci',
  company: '/employer/firma',
  payments: '/employer/platnosci',
  settings: '/employer/ustawienia',
} as const;

// Fallback DEMO (bez env / bez sesji) — panel działa bez backendu.
const DEMO_COMPANY_NAME = 'AGO Jobs & HR';

export interface EmployerShellProps {
  children: React.ReactNode;
  /** Realne powiadomienia (z sesji/RLS). Bez nich DashboardShell użyje fallbacku DEMO. */
  notifItems?: NotificationItem[];
  /** Liczba nieprzeczytanych powiadomień (badge na dzwonku). */
  notifUnread?: number;
  /** Liczba konwersacji z nieprzeczytanymi (badge pozycji „Wiadomości"). */
  unreadMessages?: number;
  /** Firmy użytkownika (przełącznik). Puste/undefined → fallback demo. */
  companies?: CompanySwitcherCompany[];
  /** Id aktywnej firmy (z kontekstu cookie). */
  activeCompanyId?: string | null;
  /** Nazwa aktywnej firmy (nagłówek sidebara). */
  activeCompanyName?: string;
  /** Nazwa zalogowanego użytkownika (topbar). */
  userName?: string;
}

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

export function EmployerShell({
  children,
  notifItems,
  notifUnread,
  unreadMessages,
  companies,
  activeCompanyId,
  activeCompanyName,
  userName,
}: EmployerShellProps): React.JSX.Element {
  const td = useTranslations('dashboard');
  const pathname = usePathname();

  const nav: DashboardNavItem[] = [
    { href: HREF.summary, label: td('navSummary'), icon: <LayoutDashboard /> },
    { href: HREF.offers, label: td('navOffers'), icon: <ClipboardList /> },
    { href: HREF.candidates, label: td('navCandidates'), icon: <Users /> },
    { href: HREF.applications, label: td('navApplications'), icon: <ClipboardList /> },
    { href: HREF.messages, label: td('navMessages'), icon: <MessageSquare /> },
    { href: HREF.company, label: td('navCompany'), icon: <Building2 /> },
    { href: HREF.payments, label: td('navPayments'), icon: <CreditCard /> },
    { href: HREF.settings, label: td('navSettings'), icon: <Settings /> },
  ];

  // Aktywna pozycja = najdłuższy pasujący href (obsługa podstron).
  const active = nav.reduce<string>((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) return best;
    return item.href.length > best.length ? item.href : best;
  }, HREF.summary);

  // Realny przełącznik firmy (FUN-07). Bez danych z sesji → fallback demo (jedna firma).
  const shellCompanies: CompanySwitcherCompany[] =
    companies && companies.length > 0 ? companies : [{ id: 'demo', name: DEMO_COMPANY_NAME, role: 'owner' }];
  const activeName = activeCompanyName || shellCompanies[0]?.name || DEMO_COMPANY_NAME;
  const brand = (
    <CompanySwitcher
      companies={shellCompanies}
      activeId={activeCompanyId ?? shellCompanies[0]?.id ?? null}
      activeName={activeName}
    />
  );

  const displayUser = userName && userName.trim().length > 0 ? userName : 'Jan Kowalski';
  return (
    <DashboardShell
      nav={nav}
      active={active}
      brand={brand}
      user={{ name: displayUser, subtitle: activeName, initials: initialsOf(displayUser) }}
      notifications={notifUnread}
      notifItems={notifItems}
      unreadMessages={unreadMessages}
    >
      {children}
    </DashboardShell>
  );
}
