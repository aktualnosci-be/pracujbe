import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';

/**
 * Layout stron uwierzytelniania (grupa `(auth)`): logowanie, rejestracja, reset hasła,
 * potwierdzenie e-mail.
 *
 * Celowo minimalny — bez pełnego Headera/Footera. Wyśrodkowane logo u góry (link do strony
 * głównej) i wyśrodkowana kolumna z treścią formularza. Dzięki temu strony auth są spokojne
 * i skupione na jednym zadaniu. Komponent serwerowy.
 *
 * NOINDEX (Invariant #9, jak panele): strony logowania/rejestracji/resetu nie powinny być
 * indeksowane. Metadata dziedziczy się do stron auth, o ile nie zostanie nadpisana.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-soft">
      <header className="flex justify-center py-8">
        <Link href="/" className="rounded-sm">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
