import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CookieConsent } from '@/components/cookies/CookieConsent';
import { inter } from '../layout';

/**
 * Layout dla segmentu językowego. To TUTAJ renderowane są <html>/<body> — z lang={locale}
 * ustawianym dynamicznie. Dostarcza wiadomości i18n do klienta (NextIntlClientProvider),
 * a także globalny chrome: Header, Footer, baner cookies. setRequestLocale włącza
 * statyczne renderowanie dla stron pod danym językiem.
 */

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

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
  const messages = await getMessages();

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <CookieConsent />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
