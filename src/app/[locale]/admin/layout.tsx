import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne } from '@/lib/db/sql';
import { captureError } from '@/lib/sentry';

/**
 * Layout panelu administratora (grupa tras `/admin/*`).
 *
 * GUARD: przy skonfigurowanym backendzie (`isPortalDataConfigured()`) wymaga (1) zalogowanego
 * użytkownika (`getPortalIdentity()`) oraz (2) roli `profiles.role = 'admin'` (rola z tożsamości). Brak sesji → redirect na /logowanie; sesja bez roli admina →
 * `notFound()` (nie ujawniamy istnienia panelu). Bez env → tryb DEMO (przepuszczamy, dane DEMO).
 *
 * Uwaga: nazwa do nagłówka czytana pod SESJĄ (RLS: własny wiersz). Dopiero warstwa danych panelu
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

  if (isPortalDataConfigured()) {
    const me = await getPortalIdentity();
    if (!me) {
      redirect({ href: '/logowanie', locale: locale as Locale });
      return null; // nieosiągalne (redirect rzuca) — zawęża typ `me` dla TS
    }

    // Rola admina jest wymagana (rola z profilu, sprawdzona przy odczycie tożsamości).
    if (me.role !== 'admin') {
      notFound();
    }

    // Imię do nagłówka panelu — własny profil pod sesją (RLS: self-select). Błąd odczytu
    // nie blokuje panelu (rola już potwierdzona) — nagłówek bez imienia.
    const record =
      (await withPortalTransaction(me, (tx) =>
        queryOne(tx, 'admin.layout-profile',
          'SELECT first_name, last_name FROM public.profiles WHERE id = $1', [me.id]),
      ).catch((error: unknown) => {
        captureError(error, { area: 'admin.layout' });
        return null;
      })) ?? {};

    const name = [asString(record['first_name']), asString(record['last_name'])]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
    userName = name.length > 0 ? name : undefined;
  }

  return <AdminShell userName={userName}>{children}</AdminShell>;
}
