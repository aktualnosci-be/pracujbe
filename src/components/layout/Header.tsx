import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LocaleSwitcher } from './LocaleSwitcher';
import { MobileNav } from './MobileNav';

/**
 * Górny pasek nawigacji (server component).
 * Zawiera logo (link do strony głównej), nawigację gościa, przełącznik języka oraz
 * przyciski logowania i dodania oferty. Na małych ekranach nawigacja i akcje chowają
 * się do panelu MobileNav (client). Teksty wyłącznie z i18n (namespace `nav`).
 */
export async function Header() {
  const t = await getTranslations('nav');

  // Tylko trasy z realnymi stronami (uniknięcie 404 na CTA). Strony treściowe
  // (jak-to-działa/poradniki) dojdą wraz z ich implementacją — patrz roadmapa CLAUDE.md.
  const navLinks = [
    { href: '/oferty-pracy', label: t('jobs') },
    { href: '/rejestracja-pracodawca', label: t('forEmployers') },
  ] as const;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="rounded-sm">
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

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <LocaleSwitcher />
          </div>
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
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
