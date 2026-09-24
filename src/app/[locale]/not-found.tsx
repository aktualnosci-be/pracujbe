import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { SkipLink } from '@/components/layout/SkipLink';

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
      <SkipLink locale={locale} />
      <Header locale={locale} />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center outline-none"
      >
        <p className="text-6xl font-bold tracking-tight text-primary" aria-hidden="true">
          404
        </p>
        <h1 className="max-w-md text-balance text-2xl font-semibold text-foreground">
          {tErrors('notFound')}
        </h1>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/oferty-pracy" className={buttonVariants({ size: 'lg' })}>
            {tNav('jobs')}
          </Link>
          <Link href="/" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
            {tCommon('home')}
          </Link>
        </div>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
