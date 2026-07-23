import type { ReactNode } from 'react';

import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

/**
 * Layout stron publicznych (grupa `(public)`).
 *
 * Dostarcza wspólny chrome witryny: sticky Header (nawigacja gościa) oraz granatową
 * stopkę. Strony treściowe (strona główna, lista ofert, szczegóły oferty itd.) renderują
 * się między nimi w `<main>`. Panele (candidate/employer), onboarding i strony auth mają
 * własne, odrębne layouty i NIE korzystają z tego chrome'u.
 *
 * Komponent serwerowy — bez interakcji na tym poziomie.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
