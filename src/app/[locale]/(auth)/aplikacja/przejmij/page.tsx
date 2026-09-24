import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GuestClaimPanel } from '@/components/public/GuestClaimPanel';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Przypisanie aplikacji gościa do konta kandydata (#98) — cel linku z e-maila
 * `guestApplicationSent`. Bez sesji: logowanie/rejestracja z powrotem na tę stronę (z tokenem).
 * Przejęcie wymaga kliknięcia (POST) i konta ze zweryfikowanym, tym samym adresem e-mail.
 * noindex (layout auth) i bez nagłówka Referer.
 */
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guestApply' });
  return { title: t('claimTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

async function hasSession(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const supabase = await createServerClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    // Brak odczytu sesji → panel pokaże logowanie; akcja i tak sprawdza sesję w bazie.
    return false;
  }
}

export default async function GuestClaimPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  const value = typeof token === 'string' ? token : '';
  const t = await getTranslations('guestApply');
  const returnTo = `/${locale}/aplikacja/przejmij?token=${encodeURIComponent(value)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">{t('claimTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <GuestClaimPanel token={value} returnTo={returnTo} signedIn={await hasSession()} />
      </CardContent>
    </Card>
  );
}
