import { UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MobileNav } from './MobileNav';

/**
 * Górny pasek nawigacji (server component) — wg makiety 01-home.
 *
 * Desktop: [logo + nawigacja gościa] ............ [Zaloguj się (ghost) · Dodaj ofertę (granat)].
 * Mobile: [hamburger] [logo wyśrodkowane] [ikona konta]. Struktura oparta na
 * `justify-between` z trzema bezpośrednimi dziećmi — środkowe (logo mobilne) trafia na
 * środek, gdy skrajne są wąskie. Selektor języka celowo NIE jest w headerze (jest w stopce
 * i w panelu mobilnym — zgodnie z makietą). Teksty wyłącznie z i18n (namespace `nav`).
 */
export async function Header() {
  const t = await getTranslations('nav');

  // Tylko trasy z realnymi stronami (uniknięcie 404 na pozycjach nawigacji). Strony
  // treściowe (jak-to-działa/poradniki) dojdą wraz z ich implementacją — patrz roadmapa.
  const navLinks = [
    { href: '/oferty-pracy', label: t('jobs') },
    { href: '/rejestracja-pracodawca', label: t('forEmployers') },
  ] as const;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-16 items-center justify-between gap-3">
        {/* Lewa strefa: hamburger (mobile) + logo (desktop) + nawigacja (desktop). */}
        <div className="flex items-center gap-6 lg:gap-8">
          <MobileNav />
          <Link href="/" className="hidden rounded-sm md:block">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Logo wyśrodkowane — tylko mobile. */}
        <Link href="/" className="rounded-sm md:hidden">
          <Logo />
        </Link>

        {/* Prawa strefa: akcje (desktop) + ikona konta (mobile). */}
        <div className="flex items-center gap-2">
          <Link
            href="/logowanie"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden md:inline-flex')}
          >
            {t('login')}
          </Link>
          <Link
            href="/rejestracja-pracodawca"
            className={cn(buttonVariants({ size: 'sm' }), 'hidden md:inline-flex')}
          >
            {t('postJob')}
          </Link>
          <Link
            href="/logowanie"
            aria-label={t('login')}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'md:hidden')}
          >
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
