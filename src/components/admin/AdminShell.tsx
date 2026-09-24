'use client';

import * as React from 'react';
import { BarChart3, Building2, Flag, History, LayoutDashboard, ListChecks, MailX, Scale, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePathname } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { AdminFeedbackProvider } from '@/components/admin/AdminFeedback';
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/DashboardShell';

/**
 * AdminShell — chrome panelu administratora. Reużywa `DashboardShell` (jasny sidebar `.side-item` +
 * topbar), tak jak panele kandydata/pracodawcy, ale z własną nawigacją: Podsumowanie / Firmy
 * / Zgłoszenia / Odwołania / Raport DSA (#43) / Pytania screeningowe (#497) / Użytkownicy / Blokady poczty (#44) / Dziennik zdarzeń (#417). Renderowane przez `admin/layout.tsx` (guard + noindex).
 *
 * Dzwonek powiadomień jest ukryty (#423) — administracja nie korzysta z kolejki notyfikacji
 * użytkownika, a pusty dzwonek byłby martwym elementem. Sygnały do działania (kolejka
 * weryfikacji, otwarte zgłoszenia) prowadzą z kafelków podsumowania. `AdminFeedbackProvider`
 * trzyma komunikaty i fokus po akcjach ponad listami (#415). Nazwa admina (`userName`) pochodzi z sesji; brak → etykieta i18n.
 */

/** Ścieżki nawigacji (bez prefiksu locale — dokłada go next-intl Link). */
const HREF = {
  summary: '/admin',
  companies: '/admin/firmy',
  reports: '/admin/zgloszenia',
  appeals: '/admin/odwolania',
  dsaReport: '/admin/raport-dsa',
  users: '/admin/uzytkownicy',
  audit: '/admin/dziennik',
  email: '/admin/poczta',
  screening: '/admin/pytania',
} as const;

/** Inicjały z nazwy (maks. 2 znaki). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || 'A';
}

export interface AdminShellProps {
  children: React.ReactNode;
  /** Nazwa zalogowanego admina (z sesji); brak → etykieta i18n `admin.adminName`. */
  userName?: string;
}

export function AdminShell({ children, userName }: AdminShellProps): React.JSX.Element {
  const t = useTranslations('admin');
  const pathname = usePathname();

  const nav: DashboardNavItem[] = [
    { href: HREF.summary, label: t('navSummary'), icon: <LayoutDashboard /> },
    { href: HREF.companies, label: t('navCompanies'), icon: <Building2 /> },
    { href: HREF.reports, label: t('navReports'), icon: <Flag /> },
    { href: HREF.appeals, label: t('navAppeals'), icon: <Scale /> },
    { href: HREF.dsaReport, label: t('navDsaReport'), icon: <BarChart3 /> },
    { href: HREF.screening, label: t('navScreening'), icon: <ListChecks /> },
    { href: HREF.users, label: t('navUsers'), icon: <Users /> },
    { href: HREF.email, label: t('navEmail'), icon: <MailX /> },
    { href: HREF.audit, label: t('navAudit'), icon: <History /> },
  ];

  // Aktywna pozycja = najdłuższy pasujący href (obsługa podstron).
  const active = nav.reduce<string>((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) return best;
    return item.href.length > best.length ? item.href : best;
  }, HREF.summary);

  const displayName = userName && userName.trim().length > 0 ? userName : t('adminName');

  const brand = (
    <div className="flex flex-col leading-tight">
      <Logo />
      <span className="text-xs text-muted-foreground">{t('brandTag')}</span>
    </div>
  );

  return (
    <DashboardShell
      nav={nav}
      active={active}
      brand={brand}
      user={{ name: displayName, subtitle: t('brandTag'), initials: initialsOf(displayName) }}
      showNotifications={false}
    >
      <AdminFeedbackProvider>{children}</AdminFeedbackProvider>
    </DashboardShell>
  );
}
