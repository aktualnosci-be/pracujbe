import type { ReactNode } from 'react';
import './globals.css';

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
