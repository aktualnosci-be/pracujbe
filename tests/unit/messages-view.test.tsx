import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { getConversationsResult, getConversationThread, markConversationRead } =
  vi.hoisted(() => ({
    getConversationsResult: vi.fn(),
    getConversationThread: vi.fn(),
    markConversationRead: vi.fn(),
  }));

const translations = { pl, nl, fr, en } as const;

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ locale }: { locale: keyof typeof translations }) =>
    (key: keyof (typeof translations)['pl']['messages']) =>
      translations[locale].messages[key],
}));

vi.mock('@/i18n/navigation', () => ({
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
vi.mock('@/components/messaging/ConversationList', () => ({
  ConversationList: () => <div>conversation-list</div>,
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
  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'jest linkiem do listy z dostępną nazwą dla locale %s',
    async (locale) => {
      getConversationsResult.mockResolvedValue({ status: 'ready', items: [{ id: 'conversation-1' }] });
      getConversationThread.mockResolvedValue({
        id: 'conversation-1',
        messages: [],
      });
      markConversationRead.mockResolvedValue(undefined);

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
});
