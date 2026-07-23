import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';

/**
 * Layout kreatora onboardingu kandydata (makieta 06).
 *
 * Celowo LEKKI — bez panelowego sidebara i bez pełnego Headera/Footera. Górny pasek
 * z samym logo (odnośnik do strony głównej) skupia uwagę na wypełnianiu profilu; sam
 * Stepper i treść kroków renderuje strona. NOINDEX (Invariant #9).
 */
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
  const tc = await getTranslations({ locale, namespace: 'common' });

  return (
    <div className="flex min-h-screen flex-col bg-soft">
      <header className="flex h-16 items-center border-b border-border bg-background px-4 lg:px-8">
        <Link href="/" aria-label={tc('home')} className="rounded-sm">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-10">{children}</main>
    </div>
  );
}
