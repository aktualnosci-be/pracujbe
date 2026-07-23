import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CandidateShell } from '@/components/candidate/CandidateShell';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Layout panelu kandydata (grupa tras `/candidate/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: granatowy sidebar + topbar) poprzez
 * kliencki `CandidateShell`, który — dla ścieżek kreatora onboardingu — świadomie
 * przepuszcza treść bez sidebara (kreator ma własny lekki layout).
 *
 * GUARD: przy skonfigurowanym Supabase wymaga zalogowanego użytkownika (getUser) —
 * brak sesji → redirect na /logowanie (z prefiksem locale). Bez env → tryb demo
 * (przepuszczamy, panel na danych DEMO). `force-dynamic`, bo guard zależy od sesji.
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

  if (isSupabaseConfigured()) {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect({ href: '/logowanie', locale: locale as Locale });
    }
  }

  return <CandidateShell>{children}</CandidateShell>;
}
