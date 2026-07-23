import localFont from 'next/font/local';

/**
 * Font Inter (zmienna CSS --font-inter, mapowana w tailwind.config.ts na font-sans).
 *
 * SELF-HOSTED OFFLINE: używamy `next/font/local` z plikiem `InterVariable.woff2`
 * dołączonym do repo (`src/app/fonts/`), zamiast `next/font/google`. Dzięki temu build
 * na self-hosted runnerze NIE wymaga sieci do Google Fonts (jeden mniej zewnętrzny zależnik
 * w czasie builda). Plik to pełny wariant zmienny Inter (oś wagi 100–900), obejmujący
 * latin + latin-ext (polskie znaki diakrytyczne).
 *
 * Zdefiniowany w osobnym module (nie w layout.tsx), ponieważ pliki route (layout/page)
 * mogą eksportować wyłącznie zarezerwowane pola Next.js. Importowany na <html> w [locale]/layout.
 */
export const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
  style: 'normal',
});
