'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bell, HelpCircle, LogOut, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { signOut } from '@/lib/actions/auth';
import { markNotificationsRead } from '@/lib/actions/notifications';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';

import { NotificationsDropdown, type NotificationItem } from './NotificationsDropdown';

/**
 * DashboardShell — współdzielony szkielet paneli (kandydat / pracodawca).
 * Odwzorowuje makiety 04 (kandydat) i 05 (pracodawca):
 *  - jasny sidebar (desktop, lg+) z brandem, nawigacją (aktywna pozycja + badge)
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
  notificationError?: boolean;
  /** Pozycje powiadomień do dropdownu (demo też z `getNotifications`, #359). Brak = pusta lista. */
  notifItems?: NotificationItem[];
  /** Liczba konwersacji z nieprzeczytanymi — badge pozycji „Wiadomości" w nawigacji. */
  unreadMessages?: number;
  /**
   * false → bez dzwonka powiadomień (panel admina nie ma kolejki notyfikacji, #423 — martwy
   * przycisk byłby ogłaszany przez czytnik ekranu). Domyślnie true.
   */
  showNotifications?: boolean;
  children: React.ReactNode;
}

const MOBILE_TABS = 5;

/**
 * `.people .side-item` (prototyp „04 Ludzie i praca”) — 13 px, padding 13/10 px, promień 10 px,
 * odstęp 10 px, margines 7 px; aktywna: jasne tło marki, ciemniejsza czerwień, 650.
 * Cel dotyku ≥ 44 px, długie etykiety NL/FR zawijają się zamiast ucinać.
 */
const SIDE_ITEM =
  'my-[7px] flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-[13px] text-[13px] leading-[1.5] transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0';
const SIDE_ITEM_MUTED = `${SIDE_ITEM} text-muted-foreground hover:bg-muted hover:text-foreground`;

export function DashboardShell({
  nav,
  active,
  brand,
  user,
  notifications,
  notificationError = false,
  notifItems,
  unreadMessages,
  showNotifications = true,
  children,
}: DashboardShellProps): React.JSX.Element {
  const tc = useTranslations('common');
  const td = useTranslations('dashboard');
  const tnav = useTranslations('nav');
  const tn = useTranslations('notifications');
  const tRoot = useTranslations();
  const router = useRouter();

  const [notifOpen, setNotifOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [, startMarkTransition] = React.useTransition();
  // #354: stan zapisu „oznacz wszystkie" — ref blokuje wielokrotne wywołanie przed re-renderem.
  const [markAllPending, startMarkAllTransition] = React.useTransition();
  const markAllInFlight = React.useRef(false);
  const [markAllDone, setMarkAllDone] = React.useState(false);
  const [markAllError, setMarkAllError] = React.useState<ErrorCode | null>(null);
  const notifRef = React.useRef<HTMLDivElement>(null);
  const bellRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const drawerCloseRef = React.useRef<HTMLButtonElement>(null);
  // Element, na który wraca fokus po zamknięciu szuflady (przycisk, który ją otworzył).
  const drawerReturnFocusRef = React.useRef<HTMLElement | null>(null);

  function openDrawer(event: React.MouseEvent<HTMLButtonElement>): void {
    drawerReturnFocusRef.current = event.currentTarget;
    setDrawerOpen(true);
  }

  // Pozycje zawsze z warstwy danych (`getNotifications` — także demo, z czasem przez
  // `Intl.RelativeTimeFormat` w języku strony, #359); bez nich pusta lista, nie literały.
  const items = notifItems ?? [];

  // Trasa „Wiadomości" (jeśli w nawigacji) — nośnik badge nieprzeczytanych rozmów.
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

  function toggleNotifications(): void {
    if (!notifOpen) {
      // Nowe otwarcie panelu = świeży stan komunikatów zapisu.
      setMarkAllDone(false);
      setMarkAllError(null);
    }
    setNotifOpen(!notifOpen);
  }

  function closeNotifications(returnFocus: boolean): void {
    setNotifOpen(false);
    if (returnFocus) bellRef.current?.focus();
  }

  // #354: wynik akcji decyduje o komunikacie — błąd zostawia licznik i pokazuje alert (bez
  // refresh, który mógłby go ukryć); sukces = status + refresh licznika.
  function handleMarkAllRead(): void {
    if (notificationError || markAllInFlight.current) return;
    markAllInFlight.current = true;
    setMarkAllDone(false);
    setMarkAllError(null);
    startMarkAllTransition(async () => {
      try {
        const res = await markNotificationsRead();
        if (!res.ok) {
          setMarkAllError(res.error);
          return;
        }
        setMarkAllDone(true);
        router.refresh();
      } catch {
        setMarkAllError('INTERNAL');
      } finally {
        markAllInFlight.current = false;
      }
    });
  }

  // #148: otwarcie pozycji oznacza JEDNO powiadomienie (RPC idempotentne: ponowne oznaczenie
  // już przeczytanego to no-op) i odświeża licznik; nawigacja Linkiem nie czeka na zapis,
  // a błąd zapisu nie zmienia celu (ten wyznaczył serwer).
  function handleItemOpen(item: NotificationItem): void {
    setNotifOpen(false);
    const id = item.id;
    if (notificationError || !item.unread || !id) return;
    startMarkTransition(async () => {
      const res = await markNotificationsRead([id]);
      if (res.ok) router.refresh();
    });
  }

  // Zamknięcie dropdownu powiadomień: klik poza obszarem; Escape (#353) zamyka i przywraca
  // fokus na dzwonek, niezależnie od tego, gdzie był fokus (panel jest odmontowywany).
  React.useEffect(() => {
    if (!notifOpen) return;
    function onPointerDown(event: MouseEvent): void {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeNotifications(true);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen]);

  // #353: wyjście fokusem (Tab/Shift+Tab) poza dzwonek i panel zamyka panel. `relatedTarget`
  // null (np. klik w niefokusowalny tekst panelu) zostawia decyzję obsłudze `mousedown`.
  function handleNotifBlur(event: React.FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (notifOpen && next instanceof Node && !event.currentTarget.contains(next)) {
      setNotifOpen(false);
    }
  }

  // Escape zamyka szufladę; blokada scrolla body przy otwartej szufladzie.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setDrawerOpen(false);
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
    <Logo />
  );

  const tabItems =
    effectiveNav.length > MOBILE_TABS
      ? effectiveNav.slice(0, MOBILE_TABS - 1)
      : effectiveNav.slice(0, MOBILE_TABS);
  const hasMore = effectiveNav.length > MOBILE_TABS;

  return (
    <div className="min-h-screen bg-soft">
      {/* Sidebar — desktop */}
      {/* `.people .sidebar` — 195 px, tło soft, linia, padding 27/18 px; `.side-person` = brand. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[195px] flex-col border-r border-border bg-soft text-foreground lg:flex">
        <div className="mx-[18px] flex min-h-16 items-center border-b border-border pb-[22px] pt-[27px]">
          {brand ?? defaultBrand}
        </div>
        <nav className="flex-1 overflow-y-auto px-[18px] py-[22px]">
          {effectiveNav.map((item) => (
            <SidebarLink key={item.href} item={item} active={item.href === active} />
          ))}
        </nav>
        <div className="mx-[18px] border-t border-border py-4">
          <Link
            href="/pomoc"
            className={SIDE_ITEM_MUTED}
          >
            <HelpCircle className="size-5 shrink-0" aria-hidden="true" />
            <span>{td('help')}</span>
          </Link>
          <LogoutButton label={td('logout')} />
        </div>
      </aside>

      {/* Kolumna główna */}
      <div className="flex min-h-screen flex-col lg:pl-[195px]">
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
            <Logo />
          </div>
          <div className="hidden flex-1 lg:block" />

          {/* Dzwonek + dropdown */}
          {showNotifications ? (
            <div ref={notifRef} className="relative" onBlur={handleNotifBlur}>
              <button
                ref={bellRef}
                type="button"
                onClick={toggleNotifications}
                // #353: nazwa dostępna niesie liczbę nieprzeczytanych (plakietka jest aria-hidden).
                aria-label={
                  notificationError ? tn('loadError') : tn('bellLabel', { count: notifications ?? 0 })
                }
                aria-haspopup="true"
                aria-expanded={notifOpen}
                className="relative inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-soft"
              >
                <Bell className="size-5" aria-hidden="true" />
                {notificationError ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
                  >
                    !
                  </span>
                ) : notifications && notifications > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground">
                    {notifications}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div className="absolute right-0 top-full z-30 mt-2">
                  <NotificationsDropdown
                    items={items}
                    count={notifications}
                    error={notificationError}
                    onRetry={() => router.refresh()}
                    onMarkAllRead={handleMarkAllRead}
                    onItemOpen={handleItemOpen}
                    markAllPending={markAllPending}
                    markAllDone={markAllDone}
                    markAllError={markAllError ? tRoot(toUserMessageKey(markAllError)) : null}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

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
        {/* `.people .dash-content` — białe tło, padding 32 px; ≤ 600 px: 26 px 6%. Dół: 96 px pod `lg`,
            bo dolny pasek zakładek (fixed, 64 px) zasłaniałby ostatni element treści. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-background px-[6%] pb-24 pt-[26px] outline-none min-[601px]:px-8 min-[601px]:pt-8 lg:pb-8"
        >
          {children}
        </main>
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
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
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
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-border bg-soft text-foreground shadow-xl"
          >
            <div className="flex h-16 items-center justify-between px-6">
              {brand ?? defaultBrand}
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={tc('cancel')}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-soft hover:text-foreground"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-[18px] py-[22px]">
              {effectiveNav.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={item.href === active}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </nav>
            <div className="mx-[18px] border-t border-border py-4">
              <Link
                href="/pomoc"
                onClick={() => setDrawerOpen(false)}
                className={SIDE_ITEM_MUTED}
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
      className={cn(SIDE_ITEM_MUTED, 'w-full disabled:cursor-not-allowed disabled:opacity-60')}
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
        SIDE_ITEM,
        active ? 'bg-primary/10 font-[650] text-primary-dark' : 'text-foreground hover:bg-muted',
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 break-words">{item.label}</span>
      {item.badge && item.badge > 0 ? (
        <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
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
        'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors [&_svg]:size-5 [&_svg]:shrink-0',
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
