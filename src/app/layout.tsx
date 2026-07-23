import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Font Inter (zmienna CSS --font-inter, mapowana w tailwind.config.ts na font-sans).
 * Definiowany tutaj (root), lecz stosowany na <html> w [locale]/layout — bo to tam
 * renderowane są znaczniki <html>/<body> (root nie zna locale). Eksport pozwala
 * je stamtąd zaimportować bez ponownego wywołania next/font.
 */
export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Root layout.
 *
 * Celowo NIE renderuje <html>/<body>. W App Router atrybut lang musi być ustawiany
 * dynamicznie zależnie od języka (SEO/dostępność), a root nie ma dostępu do params[locale].
 * Dlatego root jedynie przepuszcza children, a <html lang={locale}> renderuje
 * src/app/[locale]/layout.tsx. Import globals.css tutaj gwarantuje globalne załadowanie stylów.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
