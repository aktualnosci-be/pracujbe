import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

import type { ConversationThread } from '@/lib/data/messages';

vi.mock('next-intl/server', () => ({
  getTranslations:
    () =>
    (key: keyof (typeof en)['messages']) =>
      en.messages[key],
}));
vi.mock('@/components/messaging/ConversationCompanyBlockControl', () => ({
  ConversationCompanyBlockControl: () => <div data-testid="company-block-control" />,
}));
vi.mock('@/components/messaging/ReportContentButton', () => ({
  ReportContentButton: () => <button type="button">report</button>,
}));
vi.mock('@/components/messaging/ThreadMessageList', () => ({
  ThreadMessageList: () => <div data-testid="thread-message-list" />,
}));

import { MessageThread } from '@/components/messaging/MessageThread';

const BASE_THREAD: ConversationThread = {
  id: 'thread-1',
  subject: 'Magazynier',
  counterpartyName: 'Antwerp Logistics NV',
  messages: [],
  olderCursor: null,
};

/**
 * Bezpiecznik #832: kontrolka blokady firmy renderuje się TYLKO gdy `allowCompanyBlock`
 * (ustawiane przez `MessagesView` wyłącznie na `/candidate/wiadomosci`) ORAZ serwer dał
 * `thread.companyBlock` — brak dowolnego z tych dwóch warunków = brak kontrolki (nigdy dla
 * strony pracodawcy, także gdyby dane DEMO — które nie rozróżniają widza — ustawiły
 * `companyBlock` omyłkowo).
 */
describe('MessageThread — kontrolka blokady firmy z wątku (#832)', () => {
  it('pokazuje kontrolkę, gdy allowCompanyBlock=true i companyBlock jest ustawione (kandydat)', async () => {
    const thread: ConversationThread = {
      ...BASE_THREAD,
      companyBlock: { companyId: 'company-1', companyName: 'Antwerp Logistics NV', blocked: false },
    };
    render(
      await MessageThread({ thread, locale: 'pl', headingId: 'thread-heading', allowCompanyBlock: true }),
    );
    expect(screen.getByTestId('company-block-control')).toBeInTheDocument();
  });

  it('kontrola ujemna: ukrywa kontrolkę mimo companyBlock, gdy allowCompanyBlock=false (panel pracodawcy)', async () => {
    const thread: ConversationThread = {
      ...BASE_THREAD,
      companyBlock: { companyId: 'company-1', companyName: 'Antwerp Logistics NV', blocked: false },
    };
    render(
      await MessageThread({ thread, locale: 'pl', headingId: 'thread-heading', allowCompanyBlock: false }),
    );
    expect(screen.queryByTestId('company-block-control')).not.toBeInTheDocument();
  });

  it('domyślnie (bez podania allowCompanyBlock) nie renderuje kontrolki', async () => {
    const thread: ConversationThread = {
      ...BASE_THREAD,
      companyBlock: { companyId: 'company-1', companyName: 'Antwerp Logistics NV', blocked: false },
    };
    render(await MessageThread({ thread, locale: 'pl', headingId: 'thread-heading' }));
    expect(screen.queryByTestId('company-block-control')).not.toBeInTheDocument();
  });

  it('nie renderuje kontrolki, gdy thread.companyBlock jest null, nawet z allowCompanyBlock=true', async () => {
    const thread: ConversationThread = { ...BASE_THREAD, companyBlock: null };
    render(
      await MessageThread({ thread, locale: 'pl', headingId: 'thread-heading', allowCompanyBlock: true }),
    );
    expect(screen.queryByTestId('company-block-control')).not.toBeInTheDocument();
  });
});
