import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  AuthPage,
  AuthPageHeader,
  AuthPageTitle,
  AuthPaper,
} from '@/components/auth/auth-page';
import { GuestClaimPanel } from '@/components/public/GuestClaimPanel';
import { GuestLinkIntake } from '@/components/public/GuestLinkIntake';
import { readGuestLinkToken } from '@/lib/guest-apply/link-cookie';
import { getPortalIdentity, isPortalDataConfigured } from '@/lib/db/portal';

/**
 * Przypisanie aplikacji gościa do konta kandydata (#98) — cel linku z e-maila
 * `guestApplicationSent`. Bez sesji: logowanie/rejestracja z powrotem na czystą stronę;
 * token pozostaje w cookie HttpOnly przypisanym do tej ścieżki.
 * Przejęcie wymaga kliknięcia (POST) i konta ze zweryfikowanym, tym samym adresem e-mail.
 * noindex (layout auth) i bez nagłówka Referer.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guestApply' });
  return { title: t('claimTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

async function hasSession(): Promise<boolean> {
  if (!isPortalDataConfigured()) return false;
  try {
    return (await getPortalIdentity()) !== null;
  } catch {
    // Brak odczytu sesji → panel pokaże logowanie; akcja i tak sprawdza sesję w bazie.
    return false;
  }
}

export default async function GuestClaimPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const hasToken = Boolean(await readGuestLinkToken('claim'));
  const t = await getTranslations('guestApply');
  const returnTo = `/${locale}/aplikacja/przejmij`;

  return (
    <AuthPage>
      <AuthPageHeader>
        <AuthPageTitle>{t('claimTitle')}</AuthPageTitle>
      </AuthPageHeader>
      <AuthPaper>
        <GuestLinkIntake locale={locale} purpose="claim" hasToken={hasToken}>
          {hasToken ? <GuestClaimPanel returnTo={returnTo} signedIn={await hasSession()} /> : null}
        </GuestLinkIntake>
      </AuthPaper>
    </AuthPage>
  );
}
