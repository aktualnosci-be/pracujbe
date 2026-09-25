import type { Metadata } from 'next';

import { routing, type Locale } from '@/i18n/routing';

/**
 * Główna strona 404 — tylko dla adresów poza obsługiwanymi językami (root layout nie renderuje
 * <html>, więc ta strona robi to sama). Brak kontekstu i18n, stąd neutralny, wielojęzyczny
 * komunikat (jak w `global-error.tsx`) i linki do wszystkich wersji językowych.
 */
export const metadata: Metadata = {
  title: 'Pracuj.be — 404',
  robots: { index: false, follow: false },
};

// Record<Locale, …>: nowy język w `routing.locales` bez tekstu tutaj = błąd typecheck.
const TEXTS: Record<Locale, { message: string; home: string }> = {
  pl: { message: 'Nie znaleziono tej strony.', home: 'Strona główna' },
  nl: { message: 'Deze pagina bestaat niet.', home: 'Startpagina' },
  fr: { message: 'Cette page est introuvable.', home: 'Accueil' },
  en: { message: 'This page could not be found.', home: 'Home' },
};

const LOCALES = routing.locales.map((code) => ({ code, ...TEXTS[code] }));

export default function RootNotFound(): React.JSX.Element {
  return (
    <html lang="pl">
      <body className="flex min-h-screen items-center justify-center bg-background p-6 font-sans text-foreground">
        <main className="max-w-md space-y-6 text-center">
          <p className="pp-eyebrow">404</p>
          <h1 className="pp-page-title space-y-1">
            {LOCALES.map((l) => (
              <span key={l.code} lang={l.code} className="block">
                {l.message}
              </span>
            ))}
          </h1>
          <ul className="flex flex-wrap justify-center gap-3">
            {LOCALES.map((l) => (
              <li key={l.code}>
                <a
                  href={`/${l.code}`}
                  lang={l.code}
                  hrefLang={l.code}
                  className="pp-btn pp-btn-secondary"
                >
                  {l.home}
                </a>
              </li>
            ))}
          </ul>
        </main>
      </body>
    </html>
  );
}
