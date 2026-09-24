import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { pickClientMessages } from '@/i18n/client-messages';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { CookieConsent } from '@/components/cookies/CookieConsent';
import { SkipLink } from '@/components/layout/SkipLink';
import { consentBootScript, NOSCRIPT_HIDE_BANNER } from '@/lib/consent-boot';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { dmSans } from '../fonts';

/**
 * Layout dla segmentu językowego. To TUTAJ renderowane są <html>/<body> — z lang={locale}
 * ustawianym dynamicznie. Dostarcza wiadomości i18n do klienta (NextIntlClientProvider —
 * tylko przestrzenie nazw używane przez komponenty klienckie, patrz client-messages.ts)
 * oraz baner zgód cookie. setRequestLocale włącza statyczne renderowanie stron pod danym językiem.
 *
 * UWAGA (struktura layoutów): globalny chrome (Header/Footer) NIE jest tutaj. Trafił do
 * grupy `(public)` — src/app/[locale]/(public)/layout.tsx — aby panele (candidate/employer),
 * strony auth i onboarding mogły mieć własne, odrębne layouty. Ten layout to wyłącznie
 * powłoka dokumentu + providery.
 *
 * Kolejność na początku <body> (#212, #389): „Przejdź do treści" (każdy układ ma
 * `#main-content`) → baner zgód (w HTML z serwera, więc maluje się z FCP) → treść.
 * Skrypt w <head> ukrywa baner przed pierwszym malowaniem, gdy zgoda jest już zapisana.
 */

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Języki do prerenderu w buildzie — zawsze komplet. Pusta lista (dawniej przy skonfigurowanej
 * bazie) sprawiała, że build nie renderował stron pod `[locale]` i nie wykrywał tych, które czytają
 * cookies/nagłówki (logowanie, rejestracja, lista ofert): Next uznawał je za statyczne, a żądanie
 * kończyło się błędem DYNAMIC_SERVER_USAGE (500). Build nadal nie czyta bazy — odczyty ofert
 * w buildzie zwracają pusty wynik (`isBuildPhase`), a ISR odświeża strony po starcie.
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const [tMeta, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: 'metadata' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  return {
    metadataBase: new URL(env.siteUrl),
    title: {
      default: tMeta('homeTitle'),
      template: `%s · ${tCommon('appName')}`,
    },
    description: tMeta('homeDescription'),
    manifest: `/${locale}/manifest.webmanifest`,
    icons: {
      icon: [
        { url: '/icon.svg', type: 'image/svg+xml' },
        { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
    appleWebApp: { capable: true, statusBarStyle: 'default', title: tCommon('appName') },
    // Bez domyślnego canonical/og:url (#308): dziedziczyłyby je strony noindex (auth, 404, offline)
    // jako „duplikat” strony głównej. Każda indeksowalna strona deklaruje własny adres.
    openGraph: {
      type: 'website',
      siteName: tCommon('appName'),
      locale,
      title: tMeta('homeTitle'),
      description: tMeta('homeDescription'),
      images: [{ url: '/og.png', width: 1200, height: 630, alt: tCommon('appName') }],
    },
    twitter: {
      card: 'summary_large_image',
      title: tMeta('homeTitle'),
      description: tMeta('homeDescription'),
      images: ['/og.png'],
    },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  // Zabezpieczenie: nieobsługiwany prefiks języka → 404 (middleware zwykle to wyłapuje).
  const supportedLocales: readonly string[] = routing.locales;
  if (!supportedLocales.includes(locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = pickClientMessages(await getMessages());

  return (
    <html lang={locale} className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: consentBootScript() }} />
        {/* Bez JS przyciski banera nie działają, a bez JS nie ładuje się też żaden tracker
            (Analytics jest komponentem klienckim) — baner tylko zasłaniałby treść. */}
        <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_HIDE_BANNER }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SkipLink locale={locale} />
          <CookieConsent />
          {children}
          <ServiceWorkerRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
