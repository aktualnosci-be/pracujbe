import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Layout panelu administratora (grupa tras `/admin/*`).
 *
 * GUARD: przy skonfigurowanym Supabase wymaga (1) zalogowanego użytkownika oraz (2) roli
 * `profiles.role = 'admin'`. Brak sesji → redirect na /logowanie; sesja bez roli admina →
 * `notFound()` (nie ujawniamy istnienia panelu). Bez env → tryb DEMO (przepuszczamy, dane DEMO).
 *
 * Uwaga: guard czyta profil pod SESJĄ (RLS: własny wiersz). Dopiero warstwa danych panelu
 * (`@/lib/data/admin`) czyta service-rolem — PO potwierdzeniu roli tutaj.
 *
 * `force-dynamic` (guard zależy od sesji) + NOINDEX dla całego poddrzewa (Invariant #9).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  let userName: string | undefined;

  if (isSupabaseConfigured()) {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `user` dla TS
    }

    // Rola admina jest wymagana. Odczyt własnego profilu pod sesją (RLS: self-select).
    const { data } = await supabase
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();

    const record = (data ?? {}) as Record<string, unknown>;
    if (asString(record['role']) !== 'admin') {
      notFound();
    }

    const name = [asString(record['first_name']), asString(record['last_name'])]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
    userName = name.length > 0 ? name : undefined;
  }

  return <AdminShell userName={userName}>{children}</AdminShell>;
}
