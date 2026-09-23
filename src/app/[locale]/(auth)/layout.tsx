import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

/**
 * Layout stron uwierzytelniania (grupa `(auth)`): logowanie, rejestracja, reset hasła,
 * potwierdzenie e-mail.
 *
 * Celowo minimalny — bez pełnego Headera/Footera. U góry logo (link do strony głównej)
 * i przełącznik języka, a pod nimi wyśrodkowana kolumna z treścią formularza. Przełącznik
 * jest tu ważny: rejestracja zapisuje język strony jako `preferred_locale`, od którego zależy
 * język e-maili (Invariant #1). Zachowuje ścieżkę i parametry zapytania, a cel powrotu
 * `?next=` przenosi na wybrany język.
 * Dzięki temu strony auth są spokojne i skupione na jednym zadaniu. Komponent serwerowy.
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
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-4 py-6">
        <Link href="/" className="rounded-sm">
          <Logo />
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
