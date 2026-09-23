'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LocaleSwitcher } from './LocaleSwitcher';

/**
 * Mobilny panel nawigacji (client component) — wg makiety 01-home.
 *
 * Wyzwalacz to hamburger widoczny tylko poniżej breakpointu md (na makiecie po lewej
 * stronie paska). Wysuwany panel oparty na Radix Dialog (focus-trap, Esc, blokada scrolla)
 * zawiera nawigację gościa, przyciski logowania/dodania oferty (granat) oraz przełącznik
 * języka. Zamyka się po wyborze linku. Teksty z i18n (namespace `nav`); przyciski ikonowe
 * mają dostępne etykiety.
 */
export function MobileNav() {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);

  const navLinks = [
    { href: '/oferty-pracy', label: t('jobs') },
    { href: '/rejestracja-pracodawca', label: t('forEmployers') },
  ] as const;

  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={t('menu')}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), '-ml-2 md:hidden')}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col gap-6 overflow-y-auto bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title asChild>
              <Link href="/" onClick={close} className="rounded-sm">
                <Logo />
                <span className="sr-only">{t('menu')}</span>
              </Link>
            </Dialog.Title>
            <Dialog.Close
              aria-label={t('close')}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>

          <nav className="flex flex-col gap-1">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className="rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-soft"
              >
                {item.label}
              </Link>
            ))}
          </nav>

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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
