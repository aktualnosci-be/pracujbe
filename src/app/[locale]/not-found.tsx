import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';

/**
 * Strona 404 dla segmentu językowego.
 *
 * Wywoływana przez notFound() w obrębie [locale] (także z nieznanych ścieżek przez catch-all
 * oraz ze szczegółów ofert/poradników). Granica 404 leży NAD grupą `(public)`, więc jej layout
 * (Header/Footer) nie obejmuje tej strony — renderujemy chrome jawnie, aby użytkownik po złym
 * linku miał pełną nawigację. Akcje: strona główna (`common.home`) i lista ofert (`nav.jobs`).
 * Kod "404" jest neutralny językowo (liczba), więc nie wymaga tłumaczenia.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NotFound() {
  const locale = await getLocale();
  const [tErrors, tCommon, tNav] = await Promise.all([
    getTranslations({ locale, namespace: 'errors' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'nav' }),
  ]);

  // Metadane z not-found nie nadpisują tytułu z layoutu (zostawał tytuł strony głównej),
  // więc tytuł dokumentu ustawiamy elementem <title> (React 19 przenosi go do <head>).
  return (
    <div className="flex min-h-screen flex-col">
      <title>{`${tErrors('notFound')} · ${tCommon('appName')}`}</title>
      <Header locale={locale} />
      {/* Kalka `.p-list-header` prototypu (#7, Z5): nadtytuł, H1 `.pp-page-title` 40/32 px,
          przyciski `.btn` i `.btn.secondary`. Kod „404” jest liczbą — bez tłumaczenia. */}
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <header className="pp-list-header container pt-8 max-[600px]:pt-7">
          <p className="pp-eyebrow">404</p>
          <h1>{tErrors('notFound')}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/oferty-pracy" className="pp-btn">
              {tNav('jobs')}
            </Link>
            <Link href="/" className="pp-btn pp-btn-secondary">
              {tCommon('home')}
            </Link>
          </div>
        </header>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
