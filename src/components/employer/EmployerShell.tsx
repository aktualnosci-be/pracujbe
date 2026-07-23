'use client';

import * as React from 'react';
import {
  Building2,
  ChevronDown,
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

/**
 * EmployerShell — chrome panelu pracodawcy (makieta 05): granatowy sidebar z przełącznikiem
 * firmy + topbar z powiadomieniami i danymi użytkownika (DashboardShell). Renderowane przez
 * `employer/layout.tsx` (serwerowy, ustawia NOINDEX). Osobny komponent kliencki, bo aktywna
 * pozycja nawigacji wyznaczana jest z `usePathname`, a metadata (noindex) musi zostać
 * wyeksportowana z komponentu serwerowego — analogicznie do `CandidateShell`.
 *
 * Dane firmy/użytkownika/liczników są DEMO (backend niepodpięty) — TODO(data).
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

// TODO(data): dane firmy z sesji/backendu (przełącznik firmy).
const COMPANY_NAME = 'AGO Jobs & HR';
const COMPANY_INITIALS = 'AGO';

export function EmployerShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const td = useTranslations('dashboard');
  const pathname = usePathname();

  const nav: DashboardNavItem[] = [
    { href: HREF.summary, label: td('navSummary'), icon: <LayoutDashboard /> },
    { href: HREF.offers, label: td('navOffers'), icon: <ClipboardList /> },
    { href: HREF.candidates, label: td('navCandidates'), icon: <Users /> },
    { href: HREF.applications, label: td('navApplications'), icon: <ClipboardList />, badge: 12 },
    { href: HREF.messages, label: td('navMessages'), icon: <MessageSquare />, badge: 5 },
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

  // Przełącznik firmy w nagłówku sidebara.
  // TODO(data): realna lista firm użytkownika + zmiana aktywnej firmy.
  const brand = (
    <button
      type="button"
      aria-label={td('switchCompany')}
      className="flex w-full items-center gap-2.5 rounded-md p-1 text-left transition-colors hover:bg-white/5"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-semibold text-white"
        aria-hidden="true"
      >
        {COMPANY_INITIALS}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-semibold text-white">{COMPANY_NAME}</span>
        <span className="block truncate text-xs text-white/60">{td('employerRole')}</span>
      </span>
      <ChevronDown className="size-4 shrink-0 text-white/60" aria-hidden="true" />
    </button>
  );

  // TODO(data): realne dane użytkownika i licznik powiadomień z sesji/backendu.
  return (
    <DashboardShell
      nav={nav}
      active={active}
      brand={brand}
      user={{ name: 'Jan Kowalski', subtitle: COMPANY_NAME, initials: 'JK' }}
      notifications={5}
    >
      {children}
    </DashboardShell>
  );
}
