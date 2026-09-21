'use client';

import * as React from 'react';
import { Building2, Flag, LayoutDashboard, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePathname } from '@/i18n/navigation';
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/DashboardShell';

/**
 * AdminShell — chrome panelu administratora. Reużywa `DashboardShell` (granatowy sidebar +
 * topbar), tak jak panele kandydata/pracodawcy, ale z własną nawigacją: Podsumowanie / Firmy
 * / Zgłoszenia / Użytkownicy. Renderowane przez `admin/layout.tsx` (guard + noindex).
 *
 * Powiadomienia w panelu admina są wyłączone (pusta lista) — administracja nie korzysta z
 * kolejki notyfikacji użytkownika. Nazwa admina (`userName`) pochodzi z sesji; brak → etykieta i18n.
 */

/** Ścieżki nawigacji (bez prefiksu locale — dokłada go next-intl Link). */
const HREF = {
  summary: '/admin',
  companies: '/admin/firmy',
  reports: '/admin/zgloszenia',
  users: '/admin/uzytkownicy',
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
  const tc = useTranslations('common');
  const pathname = usePathname();

  const nav: DashboardNavItem[] = [
    { href: HREF.summary, label: t('navSummary'), icon: <LayoutDashboard /> },
    { href: HREF.companies, label: t('navCompanies'), icon: <Building2 /> },
    { href: HREF.reports, label: t('navReports'), icon: <Flag /> },
    { href: HREF.users, label: t('navUsers'), icon: <Users /> },
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
      <span className="text-lg font-semibold tracking-tight text-foreground">{tc('appName')}</span>
      <span className="text-xs text-muted-foreground">{t('brandTag')}</span>
    </div>
  );

  return (
    <DashboardShell
      nav={nav}
      active={active}
      brand={brand}
      user={{ name: displayName, subtitle: t('brandTag'), initials: initialsOf(displayName) }}
      notifItems={[]}
    >
      {children}
    </DashboardShell>
  );
}
