import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { getConversationsResult, getConversationThread, markConversationRead, refresh, captureError } =
  vi.hoisted(() => ({
    getConversationsResult: vi.fn(),
    getConversationThread: vi.fn(),
    markConversationRead: vi.fn(),
    refresh: vi.fn(),
    captureError: vi.fn(),
  }));

const translations = { pl, nl, fr, en } as const;

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ locale }: { locale: keyof typeof translations }) =>
    (key: keyof (typeof translations)['pl']['messages']) =>
      translations[locale].messages[key],
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/data/messages', () => ({
  getConversationsResult,
  getConversationThread,
}));

vi.mock('@/lib/actions/messages', () => ({ markConversationRead }));
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/components/messaging/ConversationList', () => ({
  ConversationList: ({ items }: { items: Array<{ unreadCount: number }> }) =>
    <div data-testid="conversation-list" data-unread={items[0]?.unreadCount}>conversation-list</div>,
}));
vi.mock('@/components/messaging/MessageThread', () => ({
  MessageThread: () => <div>message-thread</div>,
}));
vi.mock('@/components/messaging/MessageComposer', () => ({
  MessageComposer: () => <div>message-composer</div>,
}));

import { MessagesView } from '@/components/messaging/MessagesView';

describe('mobilny powrót z wątku wiadomości', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zachowuje polskie i francuskie znaki w nowych komunikatach', () => {
    expect(pl.messages.loadError).toBe('Nie udało się wczytać rozmów.');
    expect(pl.messages.loadErrorHint).toBe('Sprawdź połączenie i spróbuj ponownie.');
    expect(pl.messages.retry).toBe('Spróbuj ponownie');
    expect(fr.messages.loadErrorHint).toBe('Vérifiez votre connexion et réessayez.');
    expect(fr.messages.retry).toBe('Réessayer');
  });
  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'jest linkiem do listy z dostępną nazwą dla locale %s',
    async (locale) => {
      getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
      getConversationThread.mockResolvedValue({ status: 'ready', thread: {
        id: 'conversation-1', messages: [],
      } });
      markConversationRead.mockResolvedValue({ ok: true });

      render(
        await MessagesView({
          locale,
          basePath: '/candidate/wiadomosci',
          activeParam: 'conversation-1',
        }),
      );

      const backLink = screen.getByRole('link', {
        name: translations[locale].messages.back,
      });

      expect(backLink).toHaveAttribute('href', '/candidate/wiadomosci');
    },
  );

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'pokazuje błąd odczytu i ponowienie zamiast pustej listy: %s',
    async (locale) => {
      getConversationsResult.mockResolvedValue({ status: 'error', items: [] });

      render(await MessagesView({ locale, basePath: '/candidate/wiadomosci' }));

      expect(screen.getByRole('alert')).toHaveTextContent(translations[locale].messages.loadError);
      expect(screen.getByRole('link', { name: translations[locale].messages.retry }))
        .toHaveAttribute('href', '/candidate/wiadomosci');
      expect(screen.queryByText(translations[locale].messages.empty)).not.toBeInTheDocument();
      expect(markConversationRead).not.toHaveBeenCalled();
    },
  );

  it.each(['candidate', 'employer'] as const)(
    'pokazuje błąd wątku z ponowieniem w panelu %s, bez kompozytora i szczegółów bazy',
    async (role) => {
      getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
      getConversationThread.mockResolvedValue({ status: 'error' });
      markConversationRead.mockResolvedValue({ ok: true });
      const basePath = `/${role}/wiadomosci`;

      render(await MessagesView({ locale: 'pl', basePath, activeParam: 'conversation-1' }));

      expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.threadLoadError);
      expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.threadLoadErrorHint);
      fireEvent.click(screen.getByRole('button', { name: pl.messages.retry }));
      expect(refresh).toHaveBeenCalledOnce();
      expect(markConversationRead).not.toHaveBeenCalled();
      expect(screen.queryByText('message-thread')).not.toBeInTheDocument();
      expect(screen.queryByText('message-composer')).not.toBeInTheDocument();
      expect(screen.queryByText('private database detail')).not.toBeInTheDocument();
    },
  );

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'lokalizuje błąd wątku i ponowienie: %s',
    async (locale) => {
      getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
      getConversationThread.mockResolvedValue({ status: 'error' });
      render(await MessagesView({ locale, basePath: '/employer/wiadomosci', activeParam: 'conversation-1' }));
      expect(screen.getByRole('alert')).toHaveTextContent(translations[locale].messages.threadLoadError);
      expect(screen.getByRole('alert')).toHaveTextContent(translations[locale].messages.threadLoadErrorHint);
      expect(screen.getByRole('button', { name: translations[locale].messages.retry })).toBeVisible();
      expect(markConversationRead).not.toHaveBeenCalled();
    },
  );

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'pokazuje bezpieczny brak wątku, gdy jego odczyt nie zwraca danych: %s',
    async (locale) => {
      getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
      getConversationThread.mockResolvedValue({ status: 'not-found' });

      const basePath = '/candidate/wiadomosci';
      const inaccessible = await MessagesView({ locale, basePath, activeParam: 'conversation-1' });
      render(inaccessible);
      expect(screen.getByText(translations[locale].messages.threadUnavailable)).toBeVisible();
      expect(getConversationThread).toHaveBeenCalledWith('conversation-1');
      expect(screen.queryByText('message-composer')).not.toBeInTheDocument();
      expect(markConversationRead).not.toHaveBeenCalled();
    },
  );

  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'lista rozmów jest nazwanym regionem, nie nienazwanym complementary (#358): %s',
    async (locale) => {
      getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
      getConversationThread.mockResolvedValue({ status: 'ready', thread: { id: 'conversation-1', counterpartyName: 'Anna', subject: '', messages: [] } });
      markConversationRead.mockResolvedValue({ ok: true });
      render(await MessagesView({ locale, basePath: '/candidate/wiadomosci', activeParam: 'conversation-1' }));
      expect(screen.getByRole('region', { name: translations[locale].messages.conversationsHeading })).toBeInTheDocument();
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    },
  );

  it('nie odczytuje wątku spoza listy użytkownika', async () => {
    getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
    render(await MessagesView({ locale: 'pl', basePath: '/candidate/wiadomosci', activeParam: 'other-id' }));
    expect(screen.getByText(pl.messages.threadUnavailable)).toBeVisible();
    expect(getConversationThread).not.toHaveBeenCalled();
    expect(markConversationRead).not.toHaveBeenCalled();
  });

  it.each([true, false])('zmienia licznik nieprzeczytanych tylko po wyniku oznaczenia ok=%s', async (ok) => {
    getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1', unread: true, unreadCount: 2 }] });
    getConversationThread.mockResolvedValue({ status: 'ready', thread: { id: 'conversation-1', messages: [] } });
    markConversationRead.mockImplementation(async () => {
      expect(getConversationThread).toHaveBeenCalledWith('conversation-1');
      return ok ? { ok: true } : { ok: false, error: 'INTERNAL' };
    });

    render(await MessagesView({ locale: 'pl', basePath: '/candidate/wiadomosci', activeParam: 'conversation-1' }));

    expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-unread', ok ? '0' : '2');
    expect(screen.getByText('message-thread')).toBeVisible();
  });

  it('nie usuwa licznika, gdy oznaczenie przeczytania rzuci wyjątek', async () => {
    const failure = new Error('private database detail');
    getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1', unread: true, unreadCount: 2 }] });
    getConversationThread.mockResolvedValue({ status: 'ready', thread: { id: 'conversation-1', messages: [] } });
    markConversationRead.mockRejectedValue(failure);

    render(await MessagesView({ locale: 'pl', basePath: '/candidate/wiadomosci', activeParam: 'conversation-1' }));

    expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-unread', '2');
    expect(screen.getByText('message-thread')).toBeVisible();
    expect(captureError).toHaveBeenCalledWith(failure, { area: 'messages.markConversationRead' });
  });
});
