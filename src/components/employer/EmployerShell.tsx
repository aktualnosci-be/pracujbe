'use client';

import * as React from 'react';
import {
  Building2,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/DashboardShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';
import { CompanySwitcher, type CompanySwitcherCompany } from '@/components/employer/CompanySwitcher';

/**
 * EmployerShell — chrome panelu pracodawcy (makieta 05): jasny sidebar `.side-item` z REALNYM
 * przełącznikiem firmy (FUN-07) + topbar z powiadomieniami i danymi użytkownika. Renderowane
 * przez `employer/layout.tsx` (serwerowy, ustawia NOINDEX). Dane firmy/użytkownika pochodzą
 * z sesji (props). Nazwa firmy demonstracyjnej pojawia się WYŁĄCZNIE w trybie `demo` (bez env);
 * przy błędzie odczytu (`error`) lub pustej nazwie — neutralna etykieta, a w trybie `error`
 * dyskretny komunikat z ponowieniem (#401).
 */

/** Ścieżki nawigacji panelu (bez prefiksu locale — dokłada go next-intl Link). */
const HREF = {
  summary: '/employer',
  offers: '/employer/oferty',
  candidates: '/employer/kandydaci',
  applications: '/employer/aplikacje',
  messages: '/employer/wiadomosci',
  company: '/employer/firma',
  team: '/employer/zespol',
  settings: '/employer/ustawienia',
} as const;

// Fallback DEMO (tylko bez env) — panel działa bez backendu.
const DEMO_COMPANY_NAME = 'AGO Jobs & HR';

/** `demo` = brak backendu; `ok` = dane z sesji; `error` = odczyt danych konta nie powiódł się. */
export type EmployerShellMode = 'demo' | 'ok' | 'error';

export interface EmployerShellProps {
  children: React.ReactNode;
  /** Źródło danych chrome'u. Domyślnie `demo` (bez backendu). */
  mode?: EmployerShellMode;
  /** Realne powiadomienia (z sesji/RLS). Bez nich DashboardShell użyje fallbacku DEMO. */
  notifItems?: NotificationItem[];
  /** Liczba nieprzeczytanych powiadomień (badge na dzwonku). */
  notifUnread?: number;
  notificationError?: boolean;
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

function ShellLoadError(): React.JSX.Element {
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  const router = useRouter();
  return (
    <div
      role="alert"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-foreground"
    >
      <p className="min-w-0 flex-1">{td('employerShellLoadError')}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
        {tc('retry')}
      </Button>
    </div>
  );
}

export function EmployerShell({
  children,
  mode = 'demo',
  notifItems,
  notifUnread,
  notificationError,
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
    { href: HREF.applications, label: td('navEmployerApplications'), icon: <Inbox /> },
    { href: HREF.messages, label: td('navMessages'), icon: <MessageSquare /> },
    { href: HREF.company, label: td('navCompany'), icon: <Building2 /> },
    { href: HREF.team, label: td('navTeam'), icon: <UserPlus /> },
    { href: HREF.settings, label: td('navSettings'), icon: <Settings /> },
  ];

  // Aktywna pozycja = najdłuższy pasujący href (obsługa podstron).
  const active = nav.reduce<string>((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) return best;
    return item.href.length > best.length ? item.href : best;
  }, HREF.summary);

  // Realny przełącznik firmy (FUN-07). Firma demonstracyjna tylko w trybie demo (#401).
  const neutralName = td('companyFallback');
  const shellCompanies: CompanySwitcherCompany[] =
    companies && companies.length > 0
      ? companies
      : mode === 'demo'
        ? [{ id: 'demo', name: DEMO_COMPANY_NAME, role: 'owner' }]
        : [];
  const namedFallback = mode === 'demo' ? DEMO_COMPANY_NAME : neutralName;
  const activeName =
    activeCompanyName?.trim() ||
    shellCompanies.find((c) => c.id === activeCompanyId)?.name.trim() ||
    shellCompanies[0]?.name.trim() ||
    namedFallback;
  const brand = (
    <CompanySwitcher
      companies={shellCompanies}
      activeId={activeCompanyId ?? shellCompanies[0]?.id ?? null}
      activeName={activeName}
    />
  );

  // P1-09: bez realnej nazwy → neutralna etykieta, NIGDY zmyślona osoba („Jan Kowalski").
  const displayUser = userName && userName.trim().length > 0 ? userName : td('accountLabel');
  return (
    <DashboardShell
      nav={nav}
      active={active}
      brand={brand}
      user={{ name: displayUser, subtitle: activeName, initials: initialsOf(displayUser) }}
      notifications={notifUnread}
      notificationError={notificationError}
      notifItems={mode === 'demo' ? notifItems : (notifItems ?? [])}
      unreadMessages={unreadMessages}
    >
      {mode === 'error' ? <ShellLoadError /> : null}
      {children}
    </DashboardShell>
  );
}
