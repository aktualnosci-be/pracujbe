import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { getConversations, getConversationThread, markConversationRead } =
  vi.hoisted(() => ({
    getConversations: vi.fn(),
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
  getConversations,
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
  it.each(['pl', 'nl', 'fr', 'en'] as const)(
    'jest linkiem do listy z dostępną nazwą dla locale %s',
    async (locale) => {
      getConversations.mockResolvedValue([{ id: 'conversation-1' }]);
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
});
