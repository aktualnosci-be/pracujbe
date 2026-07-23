import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmployerShell } from '@/components/employer/EmployerShell';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Layout panelu pracodawcy (grupa tras `/employer/*`).
 *
 * Owija strony w chrome panelu (DashboardShell: granatowy sidebar z przełącznikiem firmy
 * + topbar) poprzez kliencki `EmployerShell`.
 *
 * GUARD: przy skonfigurowanym Supabase wymaga (1) zalogowanego użytkownika oraz
 * (2) aktywnego członkostwa w firmie (`company_members.is_active = true`). Brak sesji →
 * /logowanie; sesja bez firmy → /rejestracja-pracodawca (założenie firmy). Bez env →
 * tryb demo (przepuszczamy, panel na danych DEMO). `force-dynamic`, bo guard zależy od sesji.
 *
 * Layout pozostaje serwerowy, aby wyeksportować NOINDEX dla całego poddrzewa panelu
 * (Invariant #9) — metadata dziedziczy się do stron.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EmployerLayout({
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
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `user` dla TS
    }

    // Aktywne członkostwo w firmie jest wymagane, by wejść do panelu pracodawcy.
    // RLS pozwala czytać własny wiersz (profile_id = auth.uid()). Użytkownik może
    // należeć do wielu firm — limit(1) wystarcza do potwierdzenia dostępu.
    const { data: memberships } = await supabase
      .from('company_members')
      .select('id')
      .eq('profile_id', user.id)
      .eq('is_active', true)
      .limit(1);
    if (!memberships || memberships.length === 0) {
      redirect({ href: '/rejestracja-pracodawca', locale: locale as Locale });
    }
  }

  return <EmployerShell>{children}</EmployerShell>;
}
