import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { Link, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { Logo } from '@/components/brand/Logo';
import { getCurrentIdentity } from '@/lib/auth/current';
import { isPortalAuthConfigured } from '@/lib/env';

/**
 * Layout kreatora onboardingu kandydata (makieta 06).
 *
 * Celowo LEKKI — bez panelowego sidebara i bez pełnego Headera/Footera. Górny pasek
 * z samym logo (odnośnik do strony głównej) skupia uwagę na wypełnianiu profilu; sam
 * Stepper i treść kroków renderuje strona. NOINDEX (Invariant #9).
 *
 * GUARD (#24): przy skonfigurowanych kontach wymaga zweryfikowanej sesji (onboarding zapisuje
 * profil) — brak sesji → /logowanie. Rolę (tylko kandydat) egzekwuje layout panelu kandydata.
 * Bez konfiguracji kont → tryb demo. `force-dynamic`, bo zależy od sesji.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function OnboardingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (isPortalAuthConfigured() && !(await getCurrentIdentity())) {
    redirect({ href: '/logowanie', locale: locale as Locale });
  }

  const tc = await getTranslations({ locale, namespace: 'common' });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 items-center border-b border-border bg-background px-4 lg:px-8">
        <Link href="/" aria-label={tc('home')} className="rounded-sm">
          <Logo />
        </Link>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none lg:px-8 lg:py-10"
      >
        {children}
      </main>
    </div>
  );
}
