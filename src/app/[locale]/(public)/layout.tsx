import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { routing } from '@/i18n/routing';

/**
 * Layout stron publicznych (grupa `(public)`).
 *
 * Dostarcza wspólny chrome witryny: sticky Header (nawigacja gościa) oraz granatową
 * stopkę. Strony treściowe (strona główna, lista ofert, szczegóły oferty itd.) renderują
 * się między nimi w `<main>`. Panele (candidate/employer), onboarding i strony auth mają
 * własne, odrębne layouty i NIE korzystają z tego chrome'u.
 *
 * „Przejdź do treści" renderuje [locale]/layout (przed banerem zgód, #389).
 *
 * Komponent serwerowy — bez interakcji na tym poziomie.
 *
 * Renderowanie statyczne (#298): layouty i strony renderują się w Next 15 równolegle, więc
 * `setRequestLocale` ze strony nie zdąży przed chrome'em. Layout sam ustawia locale i podaje
 * je jawnie do Header/Footer (SkipLink — [locale]/layout) — bez tego next-intl czyta `headers()` i każda strona
 * publiczna staje się SSR z `Cache-Control: no-store`. Chrome nie zależy od sesji ani cookies
 * (stan zgód i zapisanych ofert czytają wyspy klienckie), więc może trafić do cache.
 */
/**
 * Górna granica świeżości stron publicznych (#298): treść informacyjna i poradniki zmieniają się
 * tylko przy wdrożeniu, ale cache współdzielony (CDN) nie powinien trzymać ich rok po nowym
 * wdrożeniu. Strony z ofertami ustawiają krótszy `revalidate` (Next bierze najmniejszą wartość).
 */
export const revalidate = 3600;

export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Layouty renderują się równolegle: walidacja z layoutu [locale] nie zdąży przed chrome'em,
  // a nieobsługiwany segment (np. `/brak-pliku.png`) wywołałby błąd Intl w stopce.
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
