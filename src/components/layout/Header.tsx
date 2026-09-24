import { UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HEADER_ICON_BUTTON_FIXED } from './header-sizing';
import { LocaleSwitcher } from './LocaleSwitcher';
import { MobileNav, PrimaryNav } from './MobileNav';

/**
 * Górny pasek nawigacji (server component) — wg makiety 01-home.
 *
 * Desktop (prototyp „Ludzie i praca”, `.people .nav`): [logo + pogrubione czarne linki] ......
 * [język · Zaloguj się · Dodaj ofertę (czarny przycisk)].
 * Strefy mogą się zawijać: przy powiększonym tekście (WCAG 1.4.4) na szerokościach md–lg
 * pasek przechodzi do dwóch wierszy zamiast wypychać akcje poza ekran.
 * Mobile: [hamburger] [logo wyśrodkowane] [ikona konta]. Struktura oparta na
 * `justify-between` z trzema bezpośrednimi dziećmi — środkowe (logo mobilne) trafia na
 * środek, gdy skrajne są wąskie. Na desktopie kompaktowy przełącznik języka („PL”) jak w
 * prototypie; na mobile język jest w panelu menu i w stopce. Teksty wyłącznie z i18n (`nav`).
 *
 * `locale` przychodzi jawnie z layoutu (#298): bez niego next-intl sięga po `headers()`,
 * co przełącza całe drzewo stron publicznych na renderowanie dynamiczne.
 */
export async function Header({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'nav' });

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex min-h-16 items-center md:flex-wrap justify-between gap-x-3 gap-y-2 py-2">
        {/* Lewa strefa: hamburger (mobile) + logo (desktop) + nawigacja (desktop). */}
        <div className="flex min-w-0 items-center gap-x-6 md:flex-wrap gap-y-2 lg:gap-x-8">
          <MobileNav />
          <Link href="/" className="hidden rounded-sm md:block">
            <Logo />
          </Link>
          <PrimaryNav
            className="hidden items-center gap-6 md:flex"
            linkClassName="text-sm font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary aria-[current=page]:underline aria-[current=page]:decoration-primary aria-[current=page]:decoration-2"
          />
        </div>

        {/* Logo wyśrodkowane — tylko mobile. Stały rozmiar (24 px = text-2xl przy 100%):
            logotyp nie rośnie z tekstem, więc przy 320 px i 200% nagłówek się mieści. */}
        <Link href="/" className="min-w-0 rounded-sm md:hidden">
          <Logo className="text-[24px]" />
        </Link>

        {/* Prawa strefa: akcje (desktop) + ikona konta (mobile). */}
        <div className="flex items-center gap-2 md:flex-wrap lg:gap-4">
          <div className="hidden md:block">
            <LocaleSwitcher variant="compact" />
          </div>
          <Link
            href="/logowanie"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden font-semibold md:inline-flex')}
          >
            {t('login')}
          </Link>
          <Link
            href="/rejestracja-pracodawca"
            className={cn(buttonVariants({ variant: 'ink', size: 'sm' }), 'hidden h-11 rounded-xl px-5 font-semibold md:inline-flex')}
          >
            {t('postJob')}
          </Link>
          <Link
            href="/logowanie"
            aria-label={t('login')}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), HEADER_ICON_BUTTON_FIXED, 'md:hidden')}
          >
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
