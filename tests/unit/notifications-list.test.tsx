import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import { NotificationsList } from '@/components/dashboard/NotificationsList';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import type { NotificationListItem, NotificationsPage } from '@/lib/data/notifications';

const { markNotificationsRead, loadMoreNotifications, refresh } = vi.hoisted(() => ({
  markNotificationsRead: vi.fn(),
  loadMoreNotifications: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  return {
    useTranslations: (ns?: string) =>
      actual.createTranslator({ locale: 'pl', messages: pl, namespace: ns as never }),
  };
});
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  return {
    Link: React.forwardRef<HTMLAnchorElement, {
      children: React.ReactNode;
      href: string;
      onClick?: () => void;
      className?: string;
      'aria-current'?: 'page';
    }>(function Link({ children, href, onClick, ...rest }, ref) {
      return (
        <a ref={ref} href={`/pl${href}`} onClick={(e) => { e.preventDefault(); onClick?.(); }} {...rest}>
          {children}
        </a>
      );
    }),
    usePathname: () => '/candidate',
  };
});
vi.mock('@/lib/actions/notifications', () => ({ markNotificationsRead, loadMoreNotifications }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const t = pl.notifications;

function item(n: number, unread: boolean): NotificationListItem {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Powiadomienie ${n}`,
    meta: `${n} h temu`,
    unread,
    href: `/candidate/aplikacje?n=${n}`,
    createdAt: '2026-09-20T09:00:00.000Z',
    dateLabel: '20 wrz 2026, 11:00',
  };
}

function page(items: NotificationListItem[], unread: number, more = false): NotificationsPage {
  const last = items[items.length - 1];
  return { items, unread, nextCursor: more && last ? { createdAt: last.createdAt, id: last.id } : null };
}

function renderList(initialPage: NotificationsPage, unreadOnly = false) {
  return render(
    <NotificationsList locale="pl" basePath="/candidate/powiadomienia" initialPage={initialPage} unreadOnly={unreadOnly} />,
  );
}

describe('NotificationsList (#148)', () => {
  it('pozycje są linkami do obiektu, filtr ma aria-current i adres w URL', () => {
    renderList(page([item(1, true), item(2, false)], 1));
    expect(screen.getByRole('link', { name: /Powiadomienie 1/ })).toHaveAttribute('href', '/pl/candidate/aplikacje?n=1');
    const nav = screen.getByRole('navigation', { name: t.filterLabel });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(t.filterAll);
    expect(screen.getByRole('link', { name: t.filterUnread })).toHaveAttribute('href', '/pl/candidate/powiadomienia?nieprzeczytane=1');
    expect(screen.getByText('1 nieprzeczytane')).toBeInTheDocument();
    // Przeczytana pozycja nie ma przycisku oznaczania.
    expect(screen.getAllByRole('button', { name: /Oznacz jako przeczytane:/ })).toHaveLength(1);
  });

  it('oznacza JEDNO powiadomienie, chowa przycisk, fokus na tytule, odświeża licznik', async () => {
    markNotificationsRead.mockResolvedValue({ ok: true, count: 1 });
    renderList(page([item(1, true), item(2, true)], 2));
    fireEvent.click(screen.getByRole('button', { name: `Oznacz jako przeczytane: Powiadomienie 2` }));
    // Stan listy zatwierdza się dopiero po zakończeniu przejścia (React 19) — czekamy na komunikat
    // statusu, a nie na samo wywołanie `refresh`, które pada wcześniej (pod obciążeniem = flak).
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.markedRead));
    expect(refresh).toHaveBeenCalledOnce();
    expect(markNotificationsRead).toHaveBeenCalledExactlyOnceWith([item(2, true).id]);
    expect(screen.queryByRole('button', { name: `Oznacz jako przeczytane: Powiadomienie 2` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Oznacz jako przeczytane: Powiadomienie 1` })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Powiadomienie 2/ })).toHaveFocus();
    expect(screen.getByText('1 nieprzeczytane')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(t.markedRead);
  });

  it('błąd zapisu: komunikat z kodu, pozycja zostaje nieprzeczytana, bez refresh', async () => {
    markNotificationsRead.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderList(page([item(1, true)], 1));
    fireEvent.click(screen.getByRole('button', { name: `Oznacz jako przeczytane: Powiadomienie 1` }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Oznacz jako przeczytane: Powiadomienie 1` })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('„oznacz wszystkie” woła RPC bez listy id i zeruje licznik', async () => {
    markNotificationsRead.mockResolvedValue({ ok: true, count: 2 });
    renderList(page([item(1, true), item(2, true)], 5));
    fireEvent.click(screen.getByRole('button', { name: t.markAllRead }));
    // Jak wyżej: końcowy stan = komunikat statusu (ustawiany razem z listą i licznikiem).
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.markedAllRead));
    expect(refresh).toHaveBeenCalledOnce();
    expect(markNotificationsRead).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.queryAllByRole('button', { name: /Oznacz jako przeczytane:/ })).toHaveLength(0);
    expect(screen.getByText('Brak nieprzeczytanych')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.markAllRead })).toBeDisabled();
  });

  it('otwarcie nieprzeczytanej pozycji oznacza tylko ją; przeczytanej — nic', async () => {
    markNotificationsRead.mockResolvedValue({ ok: true, count: 1 });
    renderList(page([item(1, true), item(2, false)], 1));
    fireEvent.click(screen.getByRole('link', { name: /Powiadomienie 2/ }));
    expect(markNotificationsRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: /Powiadomienie 1/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(markNotificationsRead).toHaveBeenCalledExactlyOnceWith([item(1, true).id]);
  });

  it('„Pokaż więcej” dokleja kolejną stronę kursorem i filtrem; błąd nie usuwa wczytanych', async () => {
    const first = page([item(3, true), item(2, true)], 3, true);
    loadMoreNotifications.mockResolvedValueOnce({ status: 'error' });
    renderList(first, true);
    fireEvent.click(screen.getByRole('button', { name: t.loadMore }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.moreError);
    expect(screen.getByRole('link', { name: /Powiadomienie 3/ })).toBeInTheDocument();
    expect(loadMoreNotifications).toHaveBeenLastCalledWith('pl', first.nextCursor, true);

    loadMoreNotifications.mockResolvedValueOnce({ status: 'ready', page: page([item(2, true), item(1, true)], 3) });
    // Alert pojawia się przed końcem przejścia — czekamy na gotowy przycisk ponowienia.
    const retry = await screen.findByRole('button', { name: t.retry });
    await act(async () => { fireEvent.click(retry); });
    await screen.findByText(t.listEnd);
    // Duplikat z granicy strony nie jest powielany.
    expect(screen.getAllByRole('link', { name: /Powiadomienie \d/ }).map((a) => a.textContent)).toEqual([
      `${t.unreadItem}: Powiadomienie 3`,
      `${t.unreadItem}: Powiadomienie 2`,
      `${t.unreadItem}: Powiadomienie 1`,
    ]);
  });

  it('puste widoki: wszystkie vs nieprzeczytane', () => {
    renderList(page([], 0));
    expect(screen.getByText(t.empty)).toBeInTheDocument();
    cleanup();
    renderList(page([], 0), true);
    expect(screen.getByText(t.emptyUnread)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: t.filterLabel }).querySelector('[aria-current="page"]')?.textContent).toBe(t.filterUnread);
  });
});

describe('DashboardShell — „Zobacz wszystkie” (#148)', () => {
  const nav = [{ href: '/candidate', label: 'Pulpit', icon: null }];

  it('z dedykowaną listą pokazuje link do niej i zamyka panel po kliknięciu', () => {
    render(
      <DashboardShell nav={nav as never} active="/candidate" user={{ name: 'A', initials: 'A' }} notifications={0}
        notifItems={[]} notificationsHref="/candidate/powiadomienia">
        <p>treść</p>
      </DashboardShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Powiadomienia' }));
    const seeAll = screen.getByRole('link', { name: t.seeAll });
    expect(seeAll).toHaveAttribute('href', '/pl/candidate/powiadomienia');
    fireEvent.click(seeAll);
    expect(screen.queryByRole('link', { name: t.seeAll })).not.toBeInTheDocument();
  });

  it('kontrola ujemna: bez listy (panel admina) link się nie pojawia', () => {
    render(
      <DashboardShell nav={nav as never} active="/candidate" user={{ name: 'A', initials: 'A' }} notifications={0} notifItems={[]}>
        <p>treść</p>
      </DashboardShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Powiadomienia' }));
    expect(screen.queryByRole('link', { name: t.seeAll })).not.toBeInTheDocument();
  });
});
