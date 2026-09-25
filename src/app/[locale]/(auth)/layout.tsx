import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { routing } from '@/i18n/routing';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';

/**
 * Layout stron uwierzytelniania (grupa `(auth)`): logowanie, rejestracja, reset hasła,
 * potwierdzenie e-mail, wypisanie, linki aplikacji bez konta.
 *
 * Kalka prototypu (#7, zadanie Z4 z `docs/design/people-passport/MATRIX.md`): nagłówek witryny
 * `.pp-nav` (logo 29 px, nawigacja, kod języka) i stopka jak na stronach publicznych, między nimi
 * kolumna `.extended` z kartą `.paper.demo-form` (`src/components/auth/auth-page.tsx`).
 * Przełącznik języka z nagłówka zachowuje ścieżkę, parametry i cel `?next=` — ważne, bo
 * rejestracja zapisuje język strony jako `preferred_locale`, od którego zależy język e-maili
 * (Invariant #1).
 *
 * NOINDEX (Invariant #9, jak panele): strony logowania/rejestracji/resetu nie powinny być
 * indeksowane. Metadata dziedziczy się do stron auth, o ile nie zostanie nadpisana.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Jak layout `(public)`: nieobsługiwany segment nie może dojść do Intl w stopce.
  const supportedLocales: readonly string[] = routing.locales;
  if (!supportedLocales.includes(locale)) notFound();
  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col">
      <Header locale={locale} />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <Footer locale={locale} />
    </div>
  );
}
