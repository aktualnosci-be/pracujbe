'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bell, HelpCircle, LogOut, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { signOut } from '@/lib/actions/auth';
import { markNotificationsRead } from '@/lib/actions/notifications';
import { cn } from '@/lib/utils';

import { NotificationsDropdown, type NotificationItem } from './NotificationsDropdown';

/**
 * DashboardShell — współdzielony szkielet paneli (kandydat / pracodawca).
 * Odwzorowuje makiety 04 (kandydat) i 05 (pracodawca):
 *  - granatowy sidebar (desktop, lg+) z brandem, nawigacją (aktywna pozycja + badge)
 *    oraz stopką Pomoc/Wyloguj,
 *  - topbar z dzwonkiem powiadomień (badge + dropdown) i avatarem użytkownika,
 *  - dolny tab bar (mobile) z pozycjami nawigacji (nadmiar → „Menu" otwierające szufladę).
 *
 * Komponent kliencki — obsługuje otwieranie dropdownu powiadomień i mobilnej szuflady.
 * Panele buduj z danymi DEMO; realne dane to osobny etap. Teksty chrome z i18n.
 */

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Licznik (np. nieprzeczytane wiadomości) — mały badge przy pozycji. */
  badge?: number;
}

export interface DashboardShellProps {
  nav: DashboardNavItem[];
  /** `href` aktywnej pozycji (porównywane z `nav[].href`). */
  active: string;
  /** Brand w nagłówku sidebara (np. przełącznik firmy). Domyślnie wordmark Pracuj.be. */
  brand?: React.ReactNode;
  user: { name: string; subtitle?: string; initials: string };
  /** Licznik nieprzeczytanych powiadomień (badge na dzwonku). */
  notifications?: number;
  /** Pozycje powiadomień do dropdownu. Gdy pominięte — fallback DEMO. */
  notifItems?: NotificationItem[];
  /** Liczba konwersacji z nieprzeczytanymi — badge pozycji „Wiadomości" w nawigacji. */
  unreadMessages?: number;
  children: React.ReactNode;
}

const MOBILE_TABS = 5;

export function DashboardShell({
  nav,
  active,
  brand,
  user,
  notifications,
  notifItems,
  unreadMessages,
  children,
}: DashboardShellProps): React.JSX.Element {
  const tc = useTranslations('common');
  const td = useTranslations('dashboard');
  const tnav = useTranslations('nav');
  const tn = useTranslations('notifications');
  const router = useRouter();

  const [notifOpen, setNotifOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [, startMarkTransition] = React.useTransition();
  const notifRef = React.useRef<HTMLDivElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const drawerCloseRef = React.useRef<HTMLButtonElement>(null);
  // Element, na który wraca fokus po zamknięciu szuflady (przycisk, który ją otworzył).
  const drawerReturnFocusRef = React.useRef<HTMLElement | null>(null);

  function openDrawer(event: React.MouseEvent<HTMLButtonElement>): void {
    drawerReturnFocusRef.current = event.currentTarget;
    setDrawerOpen(true);
  }

  // Powiadomienia realne (`notifItems`), a bez nich — fallback DEMO (tryb bez backendu).
  const demoNotifItems: NotificationItem[] = [
    { title: tn('sampleNewJob'), meta: '10 min', unread: true },
    { title: tn('sampleAppViewed'), meta: '1 h', unread: true },
    { title: tn('sampleMessage'), meta: '3 h', unread: false },
  ];
  const items = notifItems ?? demoNotifItems;

  // Trasa „Wiadomości" (jeśli w nawigacji) — cel „zobacz wszystkie" oraz nośnik badge.
  const messagesHref = nav.find((item) => item.href.endsWith('/wiadomosci'))?.href;

  // Badge pozycji „Wiadomości" bierze się z realnej liczby nieprzeczytanych konwersacji.
  const effectiveNav =
    unreadMessages === undefined
      ? nav
      : nav.map((item) =>
          item.href === messagesHref
            ? { ...item, badge: unreadMessages > 0 ? unreadMessages : undefined }
            : item,
        );

  function handleMarkAllRead(): void {
    startMarkTransition(async () => {
      await markNotificationsRead();
      router.refresh();
    });
  }

  // Zamknięcie dropdownu powiadomień: klik poza obszarem + Escape.
  React.useEffect(() => {
    if (!notifOpen) return;
    function onPointerDown(event: MouseEvent): void {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [notifOpen]);

  // Escape zamyka szufladę i dropdown; blokada scrolla body przy otwartej szufladzie.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setNotifOpen(false);
        setDrawerOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Focus trap szuflady (role=dialog aria-modal): po otwarciu fokus na przycisk zamknięcia,
  // Tab/Shift+Tab zapętlone wewnątrz dialogu, po zamknięciu fokus wraca na przycisk otwierający.
  React.useEffect(() => {
    if (!drawerOpen) return;
    drawerCloseRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const activeEl = document.activeElement;
      if (event.shiftKey) {
        if (activeEl === first || !drawer.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !drawer.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      drawerReturnFocusRef.current?.focus();
    };
  }, [drawerOpen]);

  const defaultBrand = (
    <span className="text-lg font-semibold tracking-tight text-white">{tc('appName')}</span>
  );

  const tabItems =
    effectiveNav.length > MOBILE_TABS
      ? effectiveNav.slice(0, MOBILE_TABS - 1)
      : effectiveNav.slice(0, MOBILE_TABS);
  const hasMore = effectiveNav.length > MOBILE_TABS;

  return (
    <div className="min-h-screen bg-soft">
      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-primary text-white lg:flex">
        <div className="flex h-16 items-center px-6">{brand ?? defaultBrand}</div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {effectiveNav.map((item) => (
            <SidebarLink key={item.href} item={item} active={item.href === active} />
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/10 px-3 py-4">
          <Link
            href="/pomoc"
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
          >
            <HelpCircle className="size-5 shrink-0" aria-hidden="true" />
            <span>{td('help')}</span>
          </Link>
          <LogoutButton label={td('logout')} />
        </div>
      </aside>

      {/* Kolumna główna */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background px-4 lg:px-8">
          <button
            type="button"
            onClick={openDrawer}
            aria-label={tnav('menu')}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            className="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-soft lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>

          <div className="flex flex-1 justify-center lg:hidden">
            <span className="text-lg font-semibold tracking-tight text-foreground">
              {tc('appName')}
            </span>
          </div>
          <div className="hidden flex-1 lg:block" />

          {/* Dzwonek + dropdown */}
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((open) => !open)}
              aria-label={tn('title')}
              aria-haspopup="true"
              aria-expanded={notifOpen}
              className="relative inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-soft"
            >
              <Bell className="size-5" aria-hidden="true" />
              {notifications && notifications > 0 ? (
                <span className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground">
                  {notifications}
                </span>
              ) : null}
            </button>
            {notifOpen ? (
              <div className="absolute right-0 top-full z-30 mt-2">
                <NotificationsDropdown
                  items={items}
                  count={notifications}
                  onMarkAllRead={handleMarkAllRead}
                  seeAllHref={messagesHref}
                />
              </div>
            ) : null}
          </div>

          {/* Użytkownik — desktop */}
          <div className="hidden items-center gap-3 lg:flex">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              {user.subtitle ? (
                <p className="text-xs text-muted-foreground">{user.subtitle}</p>
              ) : null}
            </div>
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {user.initials}
            </span>
          </div>
        </header>

        {/* Treść */}
        <main className="flex-1 px-4 py-6 pb-24 lg:px-8 lg:pb-8">{children}</main>
      </div>

      {/* Dolny tab bar — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-stretch border-t border-border bg-background lg:hidden">
        {tabItems.map((item) => (
          <BottomTab key={item.href} item={item} active={item.href === active} />
        ))}
        {hasMore ? (
          <button
            type="button"
            onClick={openDrawer}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Menu className="size-5" aria-hidden="true" />
            <span className="text-[11px] leading-none">{tnav('menu')}</span>
          </button>
        ) : null}
      </nav>

      {/* Szuflada nawigacji — mobile */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={tnav('menu')}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-primary text-white shadow-xl"
          >
            <div className="flex h-16 items-center justify-between px-6">
              {brand ?? defaultBrand}
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={tc('cancel')}
                className="inline-flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {effectiveNav.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={item.href === active}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </nav>
            <div className="space-y-1 border-t border-white/10 px-3 py-4">
              <Link
                href="/pomoc"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
              >
                <HelpCircle className="size-5 shrink-0" aria-hidden="true" />
                <span>{td('help')}</span>
              </Link>
              <LogoutButton label={td('logout')} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Wylogowanie — wołanie serwerowej akcji `signOut` (Supabase `auth.signOut()` + redirect
 * na /logowanie). `useTransition` daje stan `pending`: blokada przycisku podczas akcji
 * eliminuje podwójny submit (Invariant #11).
 */
function LogoutButton({
  label,
  onNavigate,
}: {
  label: string;
  onNavigate?: () => void;
}): React.JSX.Element {
  const [pending, startTransition] = React.useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        onNavigate?.();
        startTransition(async () => {
          await signOut();
        });
      }}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut className="size-5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: DashboardNavItem;
  active: boolean;
  onNavigate?: () => void;
}): React.JSX.Element {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors [&_svg]:size-5 [&_svg]:shrink-0',
        active ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {item.icon}
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && item.badge > 0 ? (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-foreground">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function BottomTab({
  item,
  active,
}: {
  item: DashboardNavItem;
  active: boolean;
}): React.JSX.Element {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors [&_svg]:size-5 [&_svg]:shrink-0',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="relative" aria-hidden="true">
        {item.icon}
        {item.badge && item.badge > 0 ? (
          <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground">
            {item.badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate text-[11px] leading-none">{item.label}</span>
    </Link>
  );
}
