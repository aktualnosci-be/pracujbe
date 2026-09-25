import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const { loadOlderMessages } = vi.hoisted(() => ({ loadOlderMessages: vi.fn() }));
vi.mock('@/lib/actions/messages', () => ({ loadOlderMessages }));
vi.mock('@/lib/actions/message-reports', () => ({ reportConversationContent: vi.fn() }));

import { ThreadMessageList } from '@/components/messaging/ThreadMessageList';
import type { ThreadMessageView } from '@/lib/messaging/thread-view';

const translations = { pl, nl, fr, en } as const;
const CURSOR = { createdAt: '2026-09-01T10:00:00.000001+00:00', id: '00000000-0000-4000-8000-000000000051' };

function view(n: number, mine = false): ThreadMessageView {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    body: `treść ${n}`,
    createdAt: `2026-09-01T10:00:${String(n % 60).padStart(2, '0')}.000001+00:00`,
    mine,
    senderName: mine ? 'Ja' : 'Anna Nowak',
    senderSide: mine ? 'candidate' : 'company',
    isSystem: false,
    timeLabel: `10:${n}`,
  };
}

function renderList(
  props: Partial<React.ComponentProps<typeof ThreadMessageList>> = {},
  locale: keyof typeof translations = 'pl',
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <ThreadMessageList
        locale={locale}
        conversationId="00000000-0000-4000-8000-000000000001"
        displayName="Anna Nowak"
        initialMessages={[view(52), view(53, true)]}
        initialOlderCursor={CURSOR}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const fill = (template: string, name: string) => template.replace('{name}', name);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThreadMessageList (#146, #358)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('lista jest nazwana rozmówcą: %s', (locale) => {
    renderList({}, locale);
    expect(screen.getByRole('list', { name: fill(translations[locale].messages.threadListLabel, 'Anna Nowak') })).toBeVisible();
  });

  it('nadawca i czas są przed treścią w DOM', () => {
    renderList();
    const [first, second] = screen.getAllByRole('listitem');
    // Wiadomość drugiej strony kończy przycisk zgłoszenia (0116) — po treści w DOM.
    expect(first!.textContent).toBe(`Anna Nowak · 10:52treść 52${pl.messages.reportMessage}`);
    expect(second!.textContent).toBe(`${pl.messages.you} · 10:53treść 53`);
  });

  it('doładowuje starsze na początek, chronologicznie, i kończy na początku rozmowy', async () => {
    loadOlderMessages.mockResolvedValue({ status: 'ready', messages: [view(50), view(51)], olderCursor: null });
    renderList();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: pl.messages.loadOlder }));
    });

    expect(loadOlderMessages).toHaveBeenCalledWith('pl', '00000000-0000-4000-8000-000000000001', CURSOR);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.match(/treść (\d+)/)?.[1])).toEqual(['50', '51', '52', '53']);
    expect(screen.queryByRole('button', { name: pl.messages.loadOlder })).not.toBeInTheDocument();
    expect(screen.getByText(pl.messages.threadStart)).toHaveFocus();
  });

  it('błąd doładowania ma role="alert" i ponowienie, nie „początek rozmowy"', async () => {
    loadOlderMessages.mockResolvedValueOnce({ status: 'error' });
    renderList();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: pl.messages.loadOlder }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(pl.messages.loadOlderError);
    expect(screen.queryByText(pl.messages.threadStart)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    loadOlderMessages.mockResolvedValueOnce({ status: 'ready', messages: [view(51)], olderCursor: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: pl.messages.retry }));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('odświeżona najnowsza strona scala się z wczytanymi starszymi bez duplikatów', async () => {
    const older = { createdAt: '2026-09-01T09:00:00.000001+00:00', id: '00000000-0000-4000-8000-000000000050' };
    loadOlderMessages.mockResolvedValue({ status: 'ready', messages: [view(51)], olderCursor: older });
    const { rerender } = renderList();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: pl.messages.loadOlder }));
    });
    rerender(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <ThreadMessageList
          locale="pl"
          conversationId="00000000-0000-4000-8000-000000000001"
          displayName="Anna Nowak"
          initialMessages={[view(53, true), view(54, true)]}
          initialOlderCursor={{ ...CURSOR, id: 'other' }}
        />
      </NextIntlClientProvider>,
    );
    const items = screen.getAllByRole('listitem').map((item) => item.textContent?.match(/treść (\d+)/)?.[1]);
    expect(items).toEqual(['51', '52', '53', '54']);
    // Kursor zostaje przy najstarszej wczytanej wiadomości.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: pl.messages.loadOlder }));
    });
    expect(loadOlderMessages).toHaveBeenLastCalledWith('pl', '00000000-0000-4000-8000-000000000001', older);
  });

  it('bez kursora nie pokazuje przycisku starszych', () => {
    renderList({ initialOlderCursor: null });
    expect(screen.queryByRole('button', { name: pl.messages.loadOlder })).not.toBeInTheDocument();
  });

  it('zgłoszenie (0116): przycisk tylko przy wiadomości drugiej strony, z nazwą nadawcy i czasu', () => {
    renderList({ initialOlderCursor: null });
    const buttons = screen.getAllByRole('button', { name: /Zgłoś wiadomość/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Zgłoś wiadomość: Anna Nowak · 10:52');
    const [, mine] = screen.getAllByRole('listitem');
    expect(within(mine!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('zgłoszona wiadomość (stan z bazy) pokazuje „Zgłoszono” zamiast przycisku', () => {
    renderList({ initialOlderCursor: null, reportedMessageIds: [view(52).id] });
    expect(screen.queryByRole('button', { name: /Zgłoś wiadomość/ })).not.toBeInTheDocument();
    expect(screen.getByText(pl.messages.reportedBadge)).toBeInTheDocument();
  });
});
