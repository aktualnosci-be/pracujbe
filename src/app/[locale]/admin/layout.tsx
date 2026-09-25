import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { displayName, getCurrentIdentity, readOwnProfileSummary } from '@/lib/auth/current';
import { isPortalAuthConfigured } from '@/lib/env';

/**
 * Layout panelu administratora (grupa tras `/admin/*`).
 *
 * GUARD (#24): przy skonfigurowanych kontach wymaga (1) zweryfikowanej sesji serwerowej oraz
 * (2) roli `profiles.role = 'admin'` z aktywnego profilu (`getCurrentIdentity`). Brak sesji →
 * /logowanie; sesja bez roli admina → `notFound()` (nie ujawniamy istnienia panelu). Bez
 * konfiguracji kont → tryb DEMO (przepuszczamy, dane DEMO).
 *
 * Uwaga: warstwa danych panelu (`@/lib/data/admin`) sama ponownie potwierdza rolę przed odczytem.
 *
 * `force-dynamic` (guard zależy od sesji) + NOINDEX dla całego poddrzewa (Invariant #9).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  let userName: string | undefined;

  if (isPortalAuthConfigured()) {
    const identity = await getCurrentIdentity();
    if (!identity) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ dla TS
    }
    if (identity.role !== 'admin') {
      notFound();
    }
    userName = displayName(await readOwnProfileSummary(identity));
  }

  return <AdminShell userName={userName}>{children}</AdminShell>;
}
