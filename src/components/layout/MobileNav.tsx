'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { buttonVariants } from '@/components/ui/button';
import { LightDialogContent, LightDialogRoot } from '@/components/ui/light-dialog';
import { cn } from '@/lib/utils';
import { HEADER_ICON_BUTTON_FIXED } from './header-sizing';
import { LocaleSwitcher } from './LocaleSwitcher';

/** Linki głównej nawigacji gościa — wspólne dla paska desktop (Header) i panelu mobilnego. */
export const PRIMARY_NAV = [
  { href: '/oferty-pracy', key: 'jobs' },
  { href: '/rejestracja-pracodawca', key: 'forEmployers' },
] as const;

/**
 * Nawigacja główna z oznaczeniem bieżącej strony (`aria-current="page"`). Client component,
 * bo bieżąca ścieżka pochodzi z `usePathname`; Header (server) renderuje ją w wariancie desktop.
 */
export function PrimaryNav({
  className,
  linkClassName,
  onNavigate,
}: {
  className?: string;
  linkClassName?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav aria-label={t('menu')} className={className}>
      {PRIMARY_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          aria-current={pathname === item.href ? 'page' : undefined}
          className={linkClassName}
        >
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Mobilny panel nawigacji (client component) — wg makiety 01-home.
 *
 * Wyzwalacz to hamburger widoczny tylko poniżej breakpointu md (na makiecie po lewej
 * stronie paska). Wysuwany panel na `LightDialog*` (focus-trap, Esc, blokada scrolla bez
 * przeliczania stylów całej strony — #393) zawiera nawigację gościa, przyciski
 * logowania/dodania oferty (granat) oraz przełącznik języka. Zamyka się po wyborze linku.
 * Teksty z i18n (namespace `nav`); przyciski ikonowe mają dostępne etykiety.
 */
export function MobileNav() {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <LightDialogRoot open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={t('menu')}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), HEADER_ICON_BUTTON_FIXED, '-ml-[8px] md:hidden')}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Dialog.Trigger>

      <LightDialogContent
        open={open}
        overlayClassName="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        aria-describedby={undefined}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col gap-6 overflow-y-auto bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
      >
        <Dialog.Title className="sr-only">{t('menu')}</Dialog.Title>
        <div className="flex items-center justify-between">
          <Link href="/" onClick={close} className="rounded-sm">
            <Logo />
          </Link>
          <Dialog.Close
            aria-label={t('close')}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Dialog.Close>
        </div>

        <PrimaryNav
          className="flex flex-col gap-1"
          onNavigate={close}
          linkClassName="rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-soft aria-[current=page]:bg-soft aria-[current=page]:font-semibold"
        />

        <div className="flex flex-col gap-3">
          <Link
            href="/logowanie"
            onClick={close}
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
          >
            {t('login')}
          </Link>
          <Link
            href="/rejestracja-pracodawca"
            onClick={close}
            className={cn(buttonVariants(), 'w-full')}
          >
            {t('postJob')}
          </Link>
        </div>

        <div className="mt-auto">
          <LocaleSwitcher side="top" />
        </div>
      </LightDialogContent>
    </LightDialogRoot>
  );
}
