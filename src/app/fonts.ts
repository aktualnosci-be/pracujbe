import { Inter } from 'next/font/google';

/**
 * Font Inter (zmienna CSS --font-inter, mapowana w tailwind.config.ts na font-sans).
 * Zdefiniowany w osobnym module (nie w layout.tsx), ponieważ pliki route (layout/page)
 * mogą eksportować wyłącznie zarezerwowane pola Next.js. Importowany na <html> w [locale]/layout.
 */
export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});
