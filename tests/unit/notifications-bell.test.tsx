import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { refresh, markNotificationsRead } = vi.hoisted(() => ({
  refresh: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/notifications', () => ({ markNotificationsRead }));
vi.mock('@/lib/actions/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/components/brand/Logo', () => ({ Logo: () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

import { DashboardShell } from '@/components/dashboard/DashboardShell';
import type { NotificationItem } from '@/components/dashboard/NotificationsDropdown';

const MESSAGES = { pl, nl, fr, en } as const;
type Loc = keyof typeof MESSAGES;

const ITEMS: NotificationItem[] = [
  { id: 'n1', title: 'Nowe zgłoszenie', meta: '5 min', unread: true, href: '/employer/aplikacje' },
  { id: 'n2', title: 'Stare zgłoszenie', meta: '1 d', unread: false, href: '/employer/aplikacje' },
];

function renderShell(locale: Loc, count: number, items: NotificationItem[] = ITEMS) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <button type="button">outside</button>
      <DashboardShell
        nav={[]}
        active="/employer"
        user={{ name: 'Jan', initials: 'J' }}
        notifications={count}
        notifItems={items}
      >
        <p>content</p>
      </DashboardShell>
    </NextIntlClientProvider>,
  );
}

function bell(locale: Loc) {
  return screen.getByRole('button', {
    name: new RegExp(`^${MESSAGES[locale].notifications.title}`),
  });
}

beforeEach(() => {
  refresh.mockReset();
  markNotificationsRead.mockReset();
});
afterEach(cleanup);

describe('dzwonek powiadomień (#353)', () => {
  const expected: Record<Loc, string> = {
    pl: 'Powiadomienia, 2 nieprzeczytane',
    nl: 'Meldingen, 2 ongelezen',
    fr: 'Notifications, 2 non lues',
    en: 'Notifications, 2 unread',
  };

  it.each(Object.keys(expected) as Loc[])('nazwa dzwonka zawiera liczbę nieprzeczytanych (%s)', (locale) => {
    renderShell(locale, 2);
    expect(bell(locale)).toHaveAccessibleName(expected[locale]);
  });

  it.each(Object.keys(expected) as Loc[])('przy 0 nazwa bez liczby (%s)', (locale) => {
    renderShell(locale, 0);
    expect(bell(locale)).toHaveAccessibleName(MESSAGES[locale].notifications.title);
  });

  it('polska odmiana dla 5 nieprzeczytanych', () => {
    renderShell('pl', 5);
    expect(bell('pl')).toHaveAccessibleName('Powiadomienia, 5 nieprzeczytanych');
  });

  it('panel jest nazwanym regionem, a nieprzeczytana pozycja ma tekst dla czytnika', () => {
    renderShell('nl', 1);
    fireEvent.click(bell('nl'));
    const region = screen.getByRole('region', { name: nl.notifications.title });
    const links = region.querySelectorAll('a');
    expect(links[0]).toHaveTextContent(`${nl.notifications.unreadItem}: Nowe zgłoszenie`);
    expect(links[1]).not.toHaveTextContent(nl.notifications.unreadItem);
  });

  it('Escape z wnętrza panelu zamyka go i przywraca fokus na dzwonek', () => {
    renderShell('pl', 2);
    fireEvent.click(bell('pl'));
    const markAll = screen.getByRole('button', { name: pl.notifications.markAllRead });
    markAll.focus();
    fireEvent.keyDown(markAll, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: pl.notifications.title })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(bell('pl'));
  });

  it('wyjście fokusem poza panel zamyka go', () => {
    renderShell('pl', 2);
    fireEvent.click(bell('pl'));
    const lastLink = screen.getAllByRole('link').at(-1)!;
    const outside = screen.getByRole('button', { name: 'outside' });
    fireEvent.blur(lastLink, { relatedTarget: outside });
    expect(screen.queryByRole('region', { name: pl.notifications.title })).not.toBeInTheDocument();
  });

  it('przejście fokusu wewnątrz panelu go nie zamyka', () => {
    renderShell('pl', 2);
    fireEvent.click(bell('pl'));
    const [first, second] = screen.getAllByRole('link');
    fireEvent.blur(first!, { relatedTarget: second });
    expect(screen.getByRole('region', { name: pl.notifications.title })).toBeInTheDocument();
  });
});

describe('„Oznacz wszystkie jako przeczytane” (#354)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('błąd akcji pokazuje alert z i18n bez odświeżenia (%s)', async (locale) => {
    markNotificationsRead.mockResolvedValue({ ok: false, error: 'PERMISSION_DENIED' });
    renderShell(locale, 2);
    fireEvent.click(bell(locale));
    fireEvent.click(screen.getByRole('button', { name: MESSAGES[locale].notifications.markAllRead }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES[locale].errors.permissionDenied);
    expect(refresh).not.toHaveBeenCalled();
    expect(bell(locale)).toHaveAccessibleName(
      new RegExp(`2`),
    );
  });

  it('podczas zapisu przycisk jest zajęty, a drugie kliknięcie nie wywołuje akcji', async () => {
    let resolve!: (value: unknown) => void;
    markNotificationsRead.mockReturnValue(new Promise((r) => (resolve = r)));
    renderShell('pl', 2);
    fireEvent.click(bell('pl'));
    fireEvent.click(screen.getByRole('button', { name: pl.notifications.markAllRead }));
    const busy = await screen.findByRole('button', { name: pl.notifications.markingAllRead });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(markNotificationsRead).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, count: 2 }));
  });

  it('sukces pokazuje status, odświeża licznik i nie gubi fokusu na body', async () => {
    markNotificationsRead.mockResolvedValue({ ok: true, count: 2 });
    renderShell('fr', 2);
    fireEvent.click(bell('fr'));
    const markAll = screen.getByRole('button', { name: fr.notifications.markAllRead });
    markAll.focus();
    fireEvent.click(markAll);
    expect(await screen.findByRole('status')).toHaveTextContent(fr.notifications.markedAllRead);
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: fr.notifications.title })),
    );
    expect(document.activeElement).not.toBe(document.body);
  });
});
